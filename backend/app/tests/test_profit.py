"""Rough profit on one order.

The cash-book is business-wide and allocates nothing — that stays true. This is
a READING of it: what the customer paid, minus what was marked against that
order, minus that order's share of the money that was not tied to any order,
minus what Steadfast kept.

The two derived pieces come from real rows, never a typed guess:
  shared  — every expense not marked to an order, sliced by META CHARGE DATE
            (Meta bills when the spend hits a threshold, so a charge IS the ad
            money for the days since the last charge), smoothed over 3 slices.
  courier — (collected on delivered orders) - (Steadfast payouts), per order.
"""

from datetime import timedelta
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone

from app.models import Expense, FinanceCategory, Income, Order
from app.services import profit


def make_order(*, days_ago, subtotal="2000", delivery="120", status="delivered",
               consignment="123456"):
    """A real delivered order always has a consignment; pass "" for one that was
    never booked (still in review, or handed to the customer directly)."""
    order = Order.objects.create(
        customer_name="Rahim", phone="01711000000", address="Ctg",
        subtotal=Decimal(subtotal), delivery_charge=Decimal(delivery), status=status,
        steadfast_consignment_id=consignment,
    )
    # created_at is auto_now_add, so it has to be pushed back afterwards.
    when = timezone.now() - timedelta(days=days_ago)
    Order.objects.filter(pk=order.pk).update(created_at=when)
    order.refresh_from_db()
    return order


def expense(*, amount, days_ago, category="Materials", order=None):
    cat, _ = FinanceCategory.objects.get_or_create(name=category, kind="expense")
    row = Expense.objects.create(
        category=cat, amount=Decimal(amount),
        date=timezone.localdate() - timedelta(days=days_ago),
    )
    if order:
        row.orders.add(order)
    return row


def payout(*, amount, days_ago=10):
    cat, _ = FinanceCategory.objects.get_or_create(name="Steadfast payout", kind="income")
    return Income.objects.create(
        category=cat, amount=Decimal(amount),
        date=timezone.localdate() - timedelta(days=days_ago),
    )


class ProfitBasicsTests(TestCase):
    def setUp(self):
        profit.clear_cache()

    def test_profit_is_what_is_left_after_every_deduction(self):
        order = make_order(days_ago=30, subtotal="2000", delivery="120")
        expense(amount="800", days_ago=30, order=order)          # this order's cost

        est = profit.estimate(order)

        self.assertEqual(est["collected"], Decimal("2120"))
        self.assertEqual(est["cost"], Decimal("800"))
        self.assertEqual(
            est["profit"],
            est["collected"] - est["cost"] - est["shared"] - est["courier"],
        )

    def test_the_transfer_charge_on_a_cost_counts_too(self):
        """bKash's cut to pay the supplier is money gone, same as the purchase."""
        order = make_order(days_ago=30)
        row = expense(amount="800", days_ago=30, order=order)
        row.fee_amount = Decimal("15")
        row.save(update_fields=["fee_amount"])

        self.assertEqual(profit.estimate(order)["cost"], Decimal("815"))

    def test_an_order_with_nothing_marked_says_so(self):
        order = make_order(days_ago=30)

        est = profit.estimate(order)

        self.assertEqual(est["cost"], Decimal("0"))
        self.assertFalse(est["cost_marked"])

    def test_a_cancelled_order_gets_no_estimate(self):
        order = make_order(days_ago=30, status="cancelled")
        self.assertIsNone(profit.estimate(order))

    def test_marking_money_still_changes_no_cash_book_total(self):
        """The mark stays a mark: reading it here allocates nothing."""
        from app.finance_api import month_net

        order = make_order(days_ago=1)
        before = month_net(timezone.localdate())
        expense(amount="500", days_ago=1, order=order)
        profit.estimate(order)
        after = month_net(timezone.localdate())

        self.assertEqual(before["expense"] + 500, after["expense"])


class SharedCostTests(TestCase):
    """Every taka not tied to one order is shared between the orders of its slice."""

    def setUp(self):
        profit.clear_cache()

    def test_ads_are_split_between_the_orders_of_their_charge_slice(self):
        for _ in range(4):
            make_order(days_ago=20)
        expense(amount="1200", days_ago=18, category="Ads (Facebook)")

        order = Order.objects.first()
        self.assertEqual(profit.estimate(order)["shared"], Decimal("300"))   # 1200 / 4

    def test_overheads_of_any_kind_join_the_pool(self):
        """A domain, a rickshaw fare, a page-follower advance — all shared."""
        for _ in range(4):
            make_order(days_ago=20)
        expense(amount="1200", days_ago=18, category="Ads (Facebook)")
        expense(amount="400", days_ago=19, category="Other")        # domain
        expense(amount="200", days_ago=19, category="Transport")    # rickshaw

        order = Order.objects.first()
        self.assertEqual(profit.estimate(order)["shared"], Decimal("450"))   # 1800 / 4

    def test_an_unmarked_material_is_never_shared(self):
        """A material is always for ONE sale. Unmarked means it belongs to a sale
        this order knows nothing about — a direct bKash sale, or something bought
        for the owner himself. Website orders must not pay for those."""
        for _ in range(4):
            make_order(days_ago=20)
        expense(amount="1200", days_ago=18, category="Ads (Facebook)")
        expense(amount="900", days_ago=19, category="Materials")    # direct sale

        order = Order.objects.first()
        self.assertEqual(profit.estimate(order)["shared"], Decimal("300"))   # 1200 / 4

    def test_a_cost_marked_to_an_order_is_never_also_shared(self):
        orders = [make_order(days_ago=20) for _ in range(4)]
        expense(amount="1200", days_ago=18, category="Ads (Facebook)")
        expense(amount="9999", days_ago=19, order=orders[0])   # direct, not shared

        self.assertEqual(profit.estimate(orders[1])["shared"], Decimal("300"))

    def test_ad_money_spent_before_any_order_rolls_forward(self):
        """Six weeks of ads before the first sale still has to land somewhere."""
        expense(amount="5000", days_ago=60, category="Ads (Facebook)")   # no orders yet
        for _ in range(4):
            make_order(days_ago=20)
        expense(amount="1000", days_ago=18, category="Ads (Facebook)")

        order = Order.objects.first()
        self.assertEqual(profit.estimate(order)["shared"], Decimal("1500"))  # 6000 / 4

    def test_a_thin_slice_merges_forward_instead_of_charging_one_order_everything(self):
        """Meta's billing clock must not make a quiet day look catastrophic."""
        make_order(days_ago=25)                                    # 1 order
        expense(amount="3000", days_ago=24, category="Ads (Facebook)")
        for _ in range(3):
            make_order(days_ago=20)
        expense(amount="1000", days_ago=18, category="Ads (Facebook)")

        order = Order.objects.first()
        self.assertEqual(profit.estimate(order)["shared"], Decimal("1000"))  # 4000 / 4

    def test_orders_after_the_newest_charge_are_flagged_as_not_billed(self):
        billed = [make_order(days_ago=20) for _ in range(4)]
        expense(amount="1200", days_ago=18, category="Ads (Facebook)")
        fresh = make_order(days_ago=1)

        est = profit.estimate(fresh)

        self.assertEqual(est["shared_basis"], "not_billed")
        self.assertEqual(est["shared"], Decimal("300"))       # last known rate
        self.assertEqual(profit.estimate(billed[0])["shared_basis"], "slice")

    def test_with_no_ad_charges_at_all_the_pool_is_spread_over_the_window(self):
        for _ in range(4):
            make_order(days_ago=20)
        expense(amount="800", days_ago=19, category="Other")  # unmarked, no ads anywhere

        self.assertEqual(profit.estimate(Order.objects.first())["shared"], Decimal("200"))

    def test_cancelled_orders_do_not_carry_the_shared_cost(self):
        """They earned nothing; the surviving orders bear the ad money."""
        live = [make_order(days_ago=20) for _ in range(2)]
        make_order(days_ago=20, status="cancelled")
        expense(amount="1000", days_ago=18, category="Ads (Facebook)")

        self.assertEqual(profit.estimate(live[0])["shared"], Decimal("500"))


class CourierCutTests(TestCase):
    def setUp(self):
        profit.clear_cache()

    def test_the_cut_is_what_steadfast_kept_per_delivered_order(self):
        for _ in range(10):
            make_order(days_ago=20, subtotal="1880", delivery="120")   # 2000 collected
        payout(amount="18000")                                          # 2000 kept

        self.assertEqual(profit.estimate(Order.objects.first())["courier"], Decimal("200"))

    def test_orders_delivered_in_the_last_few_days_are_not_counted_yet(self):
        """Their payout has not arrived, so counting them makes Steadfast look greedy."""
        for _ in range(10):
            make_order(days_ago=20, subtotal="1880", delivery="120")
        payout(amount="18000")
        for _ in range(5):
            make_order(days_ago=1, subtotal="1880", delivery="120")     # too fresh

        self.assertEqual(profit.estimate(Order.objects.first())["courier"], Decimal("200"))

    def test_too_little_history_falls_back_to_the_charge_on_the_order(self):
        order = make_order(days_ago=20, delivery="120")

        self.assertEqual(profit.estimate(order)["courier"], Decimal("120"))
        self.assertEqual(profit.estimate(order)["courier_basis"], "fallback")

    def test_an_impossible_cut_falls_back_rather_than_inventing_a_loss(self):
        """Payouts can exceed the window's deliveries (old orders, direct sales)."""
        for _ in range(10):
            make_order(days_ago=20, subtotal="1880", delivery="120")
        payout(amount="99000")

        est = profit.estimate(Order.objects.first())
        self.assertEqual(est["courier"], Decimal("120"))
        self.assertEqual(est["courier_basis"], "fallback")


class MoneyOutsideTheCourierTests(TestCase):
    """Money that never went through Steadfast must not look like their cut.

    The courier's deduction is derived from (what they collected) − (what they
    sent). An advance paid by bKash, or an order paid directly in full, was never
    collected by them — counting it makes the courier look like a thief.
    """

    def setUp(self):
        profit.clear_cache()

    def test_an_advance_is_not_money_the_courier_collected(self):
        for _ in range(10):
            order = make_order(days_ago=20, subtotal="1880", delivery="120")
            order.advance_received = Decimal("500")     # paid by bKash beforehand
            order.save(update_fields=["advance_received"])
        payout(amount="13000")           # they collected 1500 each, sent 1300 each

        est = profit.estimate(Order.objects.first())
        self.assertEqual(est["courier"], Decimal("200"))
        self.assertEqual(est["courier_basis"], "derived")

    def test_an_order_paid_directly_is_left_out_of_the_courier_maths(self):
        for _ in range(10):
            make_order(days_ago=20, subtotal="1880", delivery="120")
        payout(amount="18000")                          # 200 per order kept

        direct = make_order(days_ago=20, subtotal="3580", delivery="120")
        cat, _ = FinanceCategory.objects.get_or_create(name="Direct Sale", kind="income")
        income = Income.objects.create(category=cat, amount=Decimal("3700"),
                                       date=timezone.localdate() - timedelta(days=20))
        income.orders.add(direct)       # money came in by bKash, not from Steadfast
        profit.clear_cache()

        self.assertEqual(profit.estimate(Order.objects.exclude(pk=direct.pk).first())["courier"],
                         Decimal("200"))

    def test_a_marked_steadfast_payout_does_not_exclude_the_order(self):
        """Marking the payout itself against an order is still a COD order."""
        for _ in range(10):
            make_order(days_ago=20, subtotal="1880", delivery="120")
        row = payout(amount="18000")
        row.orders.add(Order.objects.first())
        profit.clear_cache()

        self.assertEqual(profit.estimate(Order.objects.first())["courier"], Decimal("200"))

    def test_a_payout_that_only_just_arrived_is_not_counted_yet(self):
        """Its order is excluded from the collected side, so counting the money
        would halve the derived cut — the asymmetry that made it read 99 instead
        of 200 on real data."""
        for _ in range(10):
            make_order(days_ago=20, subtotal="1880", delivery="120")
        payout(amount="18000", days_ago=10)      # settled, counts
        payout(amount="5000", days_ago=0)        # landed today, for fresh orders

        self.assertEqual(profit.estimate(Order.objects.first())["courier"], Decimal("200"))


class NoCourierTests(TestCase):
    """An order that never went to Steadfast must not pay a courier cut.

    An order still in review has nothing booked, and a manual order hand-delivered
    to the customer never gets a consignment at all. `steadfast_consignment_id` is
    the record of whether a parcel exists, so it is the thing to ask.
    """

    def setUp(self):
        profit.clear_cache()

    def _booked_history(self):
        for _ in range(10):
            make_order(days_ago=20, subtotal="1880", delivery="120")
        payout(amount="18000")
        profit.clear_cache()

    def test_an_order_with_no_consignment_pays_no_courier_cut(self):
        self._booked_history()
        direct = make_order(days_ago=20, subtotal="2000", delivery="0",
                            status="delivered", consignment="")

        est = profit.estimate(direct)

        self.assertEqual(est["courier"], Decimal("0"))
        self.assertEqual(est["courier_basis"], "none")
        self.assertEqual(est["profit"], est["collected"] - est["cost"] - est["shared"])

    def test_an_order_still_in_review_pays_no_courier_cut(self):
        self._booked_history()
        waiting = make_order(days_ago=1, subtotal="2000", delivery="120",
                             status="in_review", consignment="")

        self.assertEqual(profit.estimate(waiting)["courier"], Decimal("0"))

    def test_a_booked_order_still_carries_the_derived_cut(self):
        self._booked_history()

        booked = Order.objects.filter(steadfast_consignment_id="123456").first()
        est = profit.estimate(booked)
        self.assertEqual(est["courier"], Decimal("200"))
        self.assertEqual(est["courier_basis"], "derived")

    def test_unbooked_orders_do_not_shape_the_rate_either(self):
        """They were never collected by Steadfast, so they say nothing about its charge."""
        self._booked_history()
        for _ in range(5):      # hand-delivered, no consignment, no payout
            make_order(days_ago=20, subtotal="5000", delivery="0",
                       status="delivered", consignment="")
        profit.clear_cache()

        booked = Order.objects.filter(steadfast_consignment_id="123456").first()
        self.assertEqual(profit.estimate(booked)["courier"], Decimal("200"))
