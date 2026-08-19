"""Rough profit on one order, read out of the cash-book.

The cash-book itself is unchanged and still allocates nothing — this module only
READS it. Nothing here is stored, no total moves, and a mark stays a mark.

    profit = collected − cost marked on the order − shared share − courier cut

`collected` and `cost` are exact: the customer's total, and the expenses the
admin marked against that order (purchase + the transfer charge to pay it).

The other two are derived from real rows rather than typed:

**shared** — the overheads: every expense marked to no order and not a Material
or a Courier charge (so: ads, the domain, transport), sliced by META CHARGE DATE. Meta bills when the
running spend crosses a threshold, so one charge IS the ad money for the days
since the previous charge — the slice boundaries are the real billing periods,
not an arbitrary window. Each slice's pool is split between the live orders that
arrived in it, then smoothed across `SMOOTH_SLICES` so Meta's billing clock
cannot make two orders a day apart differ by a thousand taka.

**courier** — Steadfast deducts their delivery charge and 1% before paying, and
that figure is written down nowhere. But (what customers paid on delivered
orders) − (what Steadfast sent) IS that deduction, so it is derived per order.
Orders delivered in the last `PAYOUT_LAG_DAYS` are left out: their money has not
arrived yet, and counting them makes the courier look greedy.

Every branch degrades to something honest — a missing piece falls back and says
so in `*_basis`, so the panel can never present a guess as a measurement.
"""

import logging
from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from django.core.cache import cache
from django.db.models import F, Q, Sum
from django.utils import timezone

from ..models import Expense, Income, Order

logger = logging.getLogger(__name__)

ZERO = Decimal("0")

# A slice thinner than this is merged into the next one. Meta's threshold can
# fall on a quiet day, and one order should not swallow a whole charge.
MIN_ORDERS_PER_SLICE = 3
# Slices averaged together for an order's rate (this one + the two before).
SMOOTH_SLICES = 3
# Steadfast pays 2-3 days after delivery; leave a margin before counting an order.
PAYOUT_LAG_DAYS = 5
# ...and count only the payouts that had time to arrive for those orders. BOTH
# sides must be cut or the maths is asymmetric: keeping every payout while
# dropping the newest orders counts money whose order was excluded, which made
# the derived cut read HALF what the courier really charges.
PAYOUT_SETTLE_DAYS = 2
# How far back the courier maths and the no-ads fallback look.
WINDOW_DAYS = 90
# Below this many delivered orders there is not enough history to derive a cut.
MIN_DELIVERED_FOR_COURIER = 5
# A derived cut above this is not a courier charge, it is bad data.
MAX_SANE_COURIER = Decimal("1000")

_CACHE_KEY = "profit:rates:v1"
_CACHE_TTL = 600        # an estimate does not need to be to the minute


def clear_cache():
    """Drop the memoized rates (tests, and any code that just wrote finance rows)."""
    try:
        cache.delete(_CACHE_KEY)
    except Exception:                       # noqa: BLE001 - cache down is not fatal
        logger.warning("profit cache clear failed", exc_info=True)


# --------------------------------------------------------------------------- #
# The shared pool, sliced by Meta charge date
# --------------------------------------------------------------------------- #

def _order_dates():
    """Live orders as (id, local date). Cancelled ones earned nothing, so they
    carry no share — the surviving orders bear the ad money spent chasing them."""
    rows = (Order.objects.exclude(status=Order.Status.CANCELLED)
            .values_list("id", "created_at"))
    return [(pk, timezone.localtime(ts).date()) for pk, ts in rows]


def _unmarked_by_date():
    """The genuinely shared spending, summed per day.

    Two categories are kept out:

    **Courier** — the payout maths below already derives what the courier took.
    Counting it here too would be a real double charge, not a rounding error.

    **Materials** — a material is always bought for ONE sale. If it is marked to
    an order it is that order's cost exactly; if it is NOT marked, it belongs to
    a sale this system cannot see — a direct bKash sale, or something bought for
    the owner himself. Spreading those over website orders made them pay for
    dupattas sold to somebody else. The cost of an unmarked material is simply
    not a website order's cost, so it is left out rather than shared.
    """
    excluded = Q()
    for name in ("Courier", "Materials"):
        excluded |= Q(category__name__iexact=name)

    pool = defaultdict(Decimal)
    rows = (Expense.objects.filter(orders__isnull=True).exclude(excluded)
            .values("date").annotate(total=Sum(F("amount") + F("fee_amount"))))
    for row in rows:
        pool[row["date"]] += row["total"]
    return pool


def _charge_dates():
    """The days Meta actually took money. These are the slice boundaries."""
    return list(
        Expense.objects.filter(category__name__icontains="ads")
        .values_list("date", flat=True).distinct().order_by("date")
    )


def _build_slices():
    """Slice the timeline at each Meta charge, then merge the thin slices forward.

    Returns (rate_by_order_id, tail_rate) where `tail_rate` covers orders newer
    than the last charge — Meta has not billed for them yet.
    """
    orders = _order_dates()
    pool_by_date = _unmarked_by_date()
    charges = _charge_dates()

    if not orders:
        return {}, ZERO

    if not charges:
        # No ad charges recorded at all: fall back to one window-wide rate, so
        # the other unmarked spending still lands somewhere.
        start = timezone.localdate() - timedelta(days=WINDOW_DAYS)
        pool = sum((v for d, v in pool_by_date.items() if d >= start), ZERO)
        live = [o for o in orders if o[1] >= start]
        rate = (pool / len(live)) if live else ZERO
        return {pk: rate for pk, _ in live}, rate

    raw = []
    previous = None
    for end in charges:
        start = (previous + timedelta(days=1)) if previous else None
        in_slice = [pk for pk, day in orders
                    if (start is None or day >= start) and day <= end]
        pool = sum((v for d, v in pool_by_date.items()
                    if (start is None or d >= start) and d <= end), ZERO)
        raw.append({"pool": pool, "orders": in_slice})
        previous = end

    # A slice with too few orders (including the pre-launch ones, which have
    # none at all) hands its money to the next slice. Nothing is dropped: every
    # taka still lands on some order.
    slices, carry_pool, carry_orders = [], ZERO, []
    for i, s in enumerate(raw):
        pool = s["pool"] + carry_pool
        in_slice = carry_orders + s["orders"]
        if len(in_slice) < MIN_ORDERS_PER_SLICE and i < len(raw) - 1:
            carry_pool, carry_orders = pool, in_slice
            continue
        slices.append({"pool": pool, "orders": in_slice})
        carry_pool, carry_orders = ZERO, []
    if carry_orders or carry_pool:
        if slices:
            slices[-1]["pool"] += carry_pool
            slices[-1]["orders"] += carry_orders
        else:
            slices.append({"pool": carry_pool, "orders": carry_orders})

    # Smooth: an order's rate is its own slice plus the previous ones, pooled —
    # money over orders, not the average of the slice rates, so a slice with two
    # orders cannot weigh as much as a slice with twenty.
    rate_by_order, rate = {}, ZERO
    for i, s in enumerate(slices):
        window = slices[max(0, i - SMOOTH_SLICES + 1): i + 1]
        pool = sum((w["pool"] for w in window), ZERO)
        count = sum(len(w["orders"]) for w in window)
        rate = (pool / count) if count else ZERO
        for pk in s["orders"]:
            rate_by_order[pk] = rate

    return rate_by_order, rate       # last rate carries the not-yet-billed orders


# --------------------------------------------------------------------------- #
# What the courier kept
# --------------------------------------------------------------------------- #

def _courier_cut():
    """Steadfast's real deduction per delivered order, or None when underivable."""
    today = timezone.localdate()
    start = today - timedelta(days=WINDOW_DAYS)
    cutoff = today - timedelta(days=PAYOUT_LAG_DAYS)

    # An order whose money arrived some other way was never collected BY the
    # courier — counting it makes their cut look enormous. That is any order
    # carrying an income mark which is not a Steadfast payout: a direct bKash
    # sale. (Marking the payout itself against an order is still a COD order,
    # so those stay in.)
    paid_outside = set(
        Order.objects.filter(income_marks__isnull=False)
        .exclude(income_marks__category__name__icontains="steadfast")
        .values_list("id", flat=True)
    )

    delivered = [
        o for o in Order.objects.filter(status=Order.Status.DELIVERED)
        .exclude(id__in=paid_outside)
        .exclude(steadfast_consignment_id="")     # never went to the courier at all
        .values_list("subtotal", "delivery_charge", "created_at", "advance_received")
        if start <= timezone.localtime(o[2]).date() <= cutoff
    ]
    if len(delivered) < MIN_DELIVERED_FOR_COURIER:
        return None

    # What Steadfast actually collected is the COD amount, not the order total:
    # an advance the customer sent by bKash beforehand never passed through them.
    collected = sum(
        (sub + delivery - (advance or ZERO) for sub, delivery, _, advance in delivered),
        ZERO,
    )
    payouts = (Income.objects.filter(
        category__name__icontains="steadfast",
        date__gte=start,
        date__lte=today - timedelta(days=PAYOUT_SETTLE_DAYS),
    ).aggregate(t=Sum("amount"))["t"]) or ZERO

    cut = (collected - payouts) / len(delivered)
    # Payouts can cover orders outside this window (or a batch requested early),
    # which makes the arithmetic produce a negative or silly figure. Better to
    # say "I don't know" than to report a fantasy.
    if cut <= ZERO or cut > MAX_SANE_COURIER:
        return None
    return cut


# --------------------------------------------------------------------------- #
# Public
# --------------------------------------------------------------------------- #

def _rates():
    cached = None
    try:
        cached = cache.get(_CACHE_KEY)
    except Exception:                       # noqa: BLE001 - recompute instead
        logger.warning("profit cache read failed", exc_info=True)
    if cached is not None:
        return cached

    value = (_build_slices(), _courier_cut())
    try:
        cache.set(_CACHE_KEY, value, _CACHE_TTL)
    except Exception:                       # noqa: BLE001
        logger.warning("profit cache write failed", exc_info=True)
    return value


def order_cost(order):
    """What was marked against this order: purchase plus the charge to pay it."""
    return (Expense.objects.filter(orders__id=order.id)
            .aggregate(t=Sum(F("amount") + F("fee_amount")))["t"]) or ZERO


def estimate(order):
    """The rough profit breakdown for one order, or None if there isn't one.

    A cancelled order is not a sale — showing it a profit would read as money
    that exists.
    """
    if order.status == Order.Status.CANCELLED:
        return None

    (rate_by_order, tail_rate), courier = _rates()

    shared_basis = "slice"
    shared = rate_by_order.get(order.id)
    if shared is None:
        # Newer than the last Meta charge: they have not billed for it yet, so
        # its own slice would read as free. Use the latest known rate and say so.
        shared, shared_basis = tail_rate, "not_billed"

    # No parcel, no courier charge. An order still in review has nothing booked
    # yet, and a manual order handed to the customer never gets a consignment —
    # neither of them should be quietly charged for a delivery nobody made.
    if not order.steadfast_consignment_id:
        courier, courier_basis = ZERO, "none"
    elif courier is None:
        courier, courier_basis = order.delivery_charge, "fallback"
    else:
        courier_basis = "derived"

    cost = order_cost(order)
    collected = order.total
    return {
        "collected": collected,
        "cost": cost,
        "cost_marked": cost > ZERO,
        "shared": shared,
        "shared_basis": shared_basis,
        "courier": courier,
        "courier_basis": courier_basis,
        "profit": collected - cost - shared - courier,
        "window_days": WINDOW_DAYS,
    }
