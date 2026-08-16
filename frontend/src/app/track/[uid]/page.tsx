"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Container } from "@/components/ui/Container";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Badge } from "@/components/ui/Badge";
import { PriceTag } from "@/components/ui/PriceTag";
import {
  getOrder, getShopInfo, mediaUrl, submitPayment,
  type OrderDetail, type ShopInfo,
} from "@/lib/api";

// Customer order + tracking page (linked from email). Shows short uid, status,
// items, and the manual payment step when an advance is required.
// Stepper starts at "confirmed" — most orders auto-confirm and never wait on
// payment. Pending-payment orders still show it via the status badge + the
// payment form below; no need for a "waiting for payment" step in the tracker.
const STEPS = ["confirmed", "in_production", "shipped", "delivered"];
const STATUS_LABEL: Record<string, string> = {
  in_review: "যাচাই করা হচ্ছে",
  pending_payment: "পেমেন্টের অপেক্ষায়",
  confirmed: "নিশ্চিত হয়েছে",
  in_production: "তৈরি হচ্ছে",
  shipped: "পাঠানো হয়েছে",
  delivered: "পৌঁছেছে",
  cancelled: "বাতিল",
};
const STATUS_TONE: Record<string, "gold" | "success" | "error" | "neutral"> = {
  in_review: "gold",
  pending_payment: "gold",
  confirmed: "gold",
  in_production: "gold",
  shipped: "gold",
  delivered: "success",
  cancelled: "error",
};

function TrackInner() {
  const { uid } = useParams<{ uid: string }>();
  const isNew = useSearchParams().get("new") === "1";
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [shop, setShop] = useState<ShopInfo | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([getOrder(uid), getShopInfo()])
      .then(([o, s]) => { setOrder(o); setShop(s); setSubmitted(Boolean(o.transaction_id)); })
      .catch(() => setError("অর্ডার পাওয়া যায়নি"));
  }, [uid]);

  async function pay(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(""); setBusy(true);
    try {
      await submitPayment(uid, new FormData(e.currentTarget));
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "সমস্যা হয়েছে");
    } finally { setBusy(false); }
  }

  if (error && !order) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-surface-2 px-6 py-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-error/12 text-error">
            <Icon name="x" size={26} />
          </span>
          <p className="font-display text-lg font-semibold text-foreground">{error}</p>
          <Link
            href="/track"
            className="mt-2 inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-plum px-6 text-sm font-semibold text-white transition hover:bg-wine active:scale-[0.98]"
          >
            আবার চেষ্টা করুন
          </Link>
        </div>
      </Shell>
    );
  }
  if (!order) {
    return (
      <Shell>
        <p className="py-14 text-center text-sm text-muted">লোড হচ্ছে...</p>
      </Shell>
    );
  }

  // Advance is asked while the order still awaits confirmation (new orders sit in
  // in_review; legacy ones in pending_payment) and hasn't paid yet.
  const needPayment =
    order.advance_required && !submitted &&
    (order.status === "in_review" || order.status === "pending_payment");
  const stepIdx = STEPS.indexOf(order.status);
  const cancelled = order.status === "cancelled";
  // CONTACT_PHONE may hold several numbers; a tel: link takes exactly one.
  const callNumber = shop?.contact_phone?.split(",")[0]?.trim() || "";

  return (
    <Shell>
      <div className="space-y-4">
        {isNew && (
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-success/10 p-5 text-center ring-1 ring-success/25">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-success/15 text-success">
              <Icon name="check" size={22} />
            </span>
            <p className="font-display text-lg font-semibold text-foreground">আপনার অর্ডার জমা হয়েছে!</p>
            <p className="text-sm text-muted">আরও তথ্যের জন্য হোয়াটসঅ্যাপে আমাদের সাথে যোগাযোগ করুন।</p>
            {shop?.whatsapp_number && (
              <a
                href={`https://wa.me/88${shop.whatsapp_number.replace(/\D/g, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-2 rounded-full bg-success px-5 py-2.5 text-base font-semibold text-white"
              >
                <Icon name="phone" size={18} />
                {shop.whatsapp_number}
              </a>
            )}
          </div>
        )}
        {order.is_repeat_customer && (
          <div className="flex items-center justify-center gap-2 rounded-2xl bg-gold/10 p-3 text-center text-sm font-semibold text-plum ring-1 ring-gold/25">
            <Icon name="sparkles" size={16} className="text-gold" />
            আবার অর্ডার করার জন্য ধন্যবাদ!
          </div>
        )}

        {/* Order code — the one thing the customer reads out on the phone, so it
            is the biggest thing on the page and copyable in one tap. */}
        <div className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-border">
          <div className="brand-gradient px-5 py-6 text-center text-white">
            <p className="text-xs font-semibold tracking-wide text-white/80">অর্ডার কোড</p>
            <p className="mt-1 font-display text-3xl font-bold tracking-[0.2em]">{order.uid}</p>
            <div className="mt-3 flex justify-center">
              <CopyLine label="কোড কপি করুন" value={order.uid} tone="light" />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 px-5 py-4 text-center">
            <Badge tone={STATUS_TONE[order.status] ?? "neutral"}>
              {STATUS_LABEL[order.status] ?? order.status}
            </Badge>
            {order.created_at && (
              <span className="inline-flex items-center gap-1.5 text-sm text-muted">
                <Icon name="clock" size={15} />
                {formatDate(order.created_at)}
              </span>
            )}
          </div>
          {order.steadfast_tracking_code && (
            <div className="border-t border-border px-5 py-3">
              <CopyLine
                label="কুরিয়ার ট্র্যাকিং নম্বর"
                value={order.steadfast_tracking_code}
                showValue
              />
            </div>
          )}
        </div>

        {/* Progress tracker */}
        {!cancelled ? (
          <div className="rounded-2xl bg-surface p-5 shadow-sm ring-1 ring-border">
            <Stepper stepIdx={stepIdx} />
            {(order.status === "in_review" || order.status === "pending_payment") && (
              <p className="mt-4 rounded-xl bg-gold/10 px-4 py-3 text-center text-sm text-foreground">
                আমরা শীঘ্রই ফোন করে আপনার অর্ডার নিশ্চিত করব।
              </p>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-2xl bg-error/8 p-5 ring-1 ring-error/25">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-error/15 text-error">
              <Icon name="x" size={20} />
            </span>
            <p className="text-sm font-semibold text-foreground">
              এই অর্ডারটি বাতিল হয়েছে। প্রয়োজনে আমাদের সাথে যোগাযোগ করুন।
            </p>
          </div>
        )}

        {needPayment && (
          <form
            onSubmit={pay}
            className="space-y-3 rounded-2xl bg-surface p-5 shadow-sm ring-2 ring-gold/40"
          >
            <p className="text-sm font-semibold text-foreground">
              অগ্রিম <PriceTag price={order.advance_amount} size="sm" /> পাঠান, তারপর তথ্য দিন।
            </p>
            <PaymentNumbers bkash={shop?.bkash_number || ""} nagad={shop?.nagad_number || ""} />
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-foreground">পেমেন্ট মাধ্যম</label>
              <select
                name="payment_method"
                required
                className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-base outline-none focus:border-plum"
              >
                <option value="bkash">বিকাশ</option>
                <option value="nagad">নগদ</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-foreground">ট্রানজেকশন আইডি</label>
              <input
                name="transaction_id"
                required
                placeholder="ট্রানজেকশন আইডি"
                className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-base outline-none focus:border-plum"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-foreground">পেমেন্টের স্ক্রিনশট (থাকলে)</label>
              <input
                type="file"
                name="payment_screenshot"
                accept="image/*"
                className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-plum"
              />
            </div>
            {error && <p className="text-center text-sm text-error">{error}</p>}
            <button
              disabled={busy}
              className="inline-flex min-h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-plum px-8 text-base font-semibold text-white transition hover:bg-wine active:scale-[0.98] disabled:opacity-50"
            >
              {busy ? "পাঠানো হচ্ছে..." : "পেমেন্ট তথ্য পাঠান"}
            </button>
          </form>
        )}

        {submitted && (order.status === "in_review" || order.status === "pending_payment") && (
          <div className="flex items-center justify-center gap-2 rounded-2xl bg-surface p-4 text-center text-sm shadow-sm ring-1 ring-border">
            <span className="text-success"><Icon name="check" size={18} /></span>
            পেমেন্ট তথ্য পেয়েছি, যাচাই চলছে।
          </div>
        )}

        {/* Items */}
        <div className="rounded-2xl bg-surface p-5 shadow-sm ring-1 ring-border">
          <SectionTitle icon="gift">আপনার পণ্য</SectionTitle>
          {order.items.map((it) => (
            <div key={it.id} className="flex gap-3 border-b border-border py-3 last:border-0 last:pb-0">
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-surface-2">
                {it.preview_image ? (
                  <Image src={mediaUrl(it.preview_image)} alt="" fill sizes="64px" className="object-cover" />
                ) : (
                  <span className="flex h-full items-center justify-center text-plum/25">
                    <Icon name="image" size={20} />
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-semibold text-foreground">{it.product_name}</div>
                {(it.config_display?.length ?? 0) > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {it.config_display.map((c, i) => (
                      <li key={i} className="flex gap-1.5 text-xs text-muted">
                        <span className="shrink-0">{c.label}:</span>
                        <span className="min-w-0 wrap-break-word text-foreground/80">{c.value}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <PriceTag price={it.price_snapshot} size="sm" />
            </div>
          ))}

          {/* Money breakdown — delivery charge is the number customers ask about
              most, so it is shown rather than hidden inside the total. */}
          <div className="mt-4 space-y-1.5 border-t border-border pt-3">
            <SummaryRow label="পণ্যের দাম" value={order.subtotal} />
            <SummaryRow label="ডেলিভারি চার্জ" value={order.delivery_charge} />
            {Number(order.advance_amount) > 0 && order.transaction_id && (
              <SummaryRow label="অগ্রিম দেওয়া হয়েছে" value={order.advance_amount} />
            )}
            <div className="mt-2 flex items-center justify-between border-t border-border pt-3">
              <span className="font-display text-lg font-semibold text-foreground">মোট</span>
              <PriceTag price={order.total} size="lg" />
            </div>
            <p className="pt-1 text-center text-xs text-muted">ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে টাকা দিন</p>
          </div>
        </div>

        {/* Delivery address — so the customer can spot a wrong address before the
            parcel leaves, and read it back to us on the phone. */}
        <div className="rounded-2xl bg-surface p-5 shadow-sm ring-1 ring-border">
          <SectionTitle icon="truck">ডেলিভারি ঠিকানা</SectionTitle>
          <div className="space-y-2.5 text-sm">
            <AddressRow icon="user" label="নাম" value={order.customer_name} />
            <AddressRow icon="phone" label="মোবাইল" value={order.phone} />
            {order.whatsapp && order.whatsapp !== order.phone && (
              <AddressRow icon="chat" label="হোয়াটসঅ্যাপ" value={order.whatsapp} />
            )}
            <AddressRow icon="pin" label="ঠিকানা" value={order.full_address || order.address} />
          </div>
          <p className="mt-3 rounded-xl bg-surface-2 px-4 py-2.5 text-xs text-muted">
            ঠিকানা ভুল থাকলে দ্রুত আমাদের জানান — পণ্য পাঠানোর আগে ঠিক করে দেব।
          </p>
        </div>

        {/* Help — one tap to a human, on every order, not only a brand-new one. */}
        {(shop?.whatsapp_number || callNumber) && (
          <div className="rounded-2xl bg-surface p-5 text-center shadow-sm ring-1 ring-border">
            <p className="font-display text-base font-semibold text-foreground">কোনো প্রশ্ন আছে?</p>
            <p className="mt-1 text-sm text-muted">অর্ডার কোড {order.uid} বলে আমাদের সাথে কথা বলুন।</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-center">
              {shop?.whatsapp_number && (
                <a
                  href={`https://wa.me/88${shop.whatsapp_number.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-success px-6 text-base font-semibold text-white transition active:scale-[0.98]"
                >
                  <Icon name="chat" size={18} /> হোয়াটসঅ্যাপ
                </a>
              )}
              {callNumber && (
                <a
                  href={`tel:${callNumber.replace(/\s/g, "")}`}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-plum/25 bg-surface px-6 text-base font-semibold text-plum transition active:scale-[0.98]"
                >
                  <Icon name="phone" size={18} /> ফোন করুন
                </a>
              )}
            </div>
          </div>
        )}

        <Link
          href="/"
          className="block py-2 text-center text-sm font-semibold text-plum hover:text-gold"
        >
          হোমে ফিরুন
        </Link>
      </div>
    </Shell>
  );
}

// When the order was placed, in Bengali — date and time, so a customer who
// ordered twice in one day can tell which order this page is.
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("bn-BD", {
    day: "numeric", month: "long", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

function SectionTitle({ icon, children }: { icon: IconName; children: React.ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 font-display text-base font-semibold text-foreground">
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-plum/8 text-plum">
        <Icon name={icon} size={16} />
      </span>
      {children}
    </h2>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted">{label}</span>
      <span className="font-semibold text-foreground">৳{Number(value) || value}</span>
    </div>
  );
}

function AddressRow({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 shrink-0 text-plum/60"><Icon name={icon} size={16} /></span>
      <div className="min-w-0">
        <div className="text-xs text-muted">{label}</div>
        <div className="wrap-break-word font-semibold text-foreground">{value}</div>
      </div>
    </div>
  );
}

/**
 * Four workflow steps with the progress drawn as a filled rail behind them —
 * a row of loose circles reads as four unrelated icons on a small screen.
 * `stepIdx` is -1 while the order still awaits confirmation: nothing is filled,
 * which is the truth.
 */
function Stepper({ stepIdx }: { stepIdx: number }) {
  const pct = stepIdx <= 0 ? 0 : (stepIdx / (STEPS.length - 1)) * 100;
  return (
    <div className="relative">
      {/* Rail sits behind the circles, inset by half a column so it starts and
          ends at the first/last circle instead of the card edge. */}
      <div className="absolute left-[12.5%] right-[12.5%] top-4.75 h-1 rounded-full bg-surface-2" />
      <div
        className="absolute left-[12.5%] top-4.75 h-1 rounded-full bg-plum transition-[width] duration-500"
        style={{ width: `calc((100% - 25%) * ${pct / 100})` }}
      />
      <div className="relative grid grid-cols-4">
        {STEPS.map((s, i) => {
          const done = i < stepIdx;
          const current = i === stepIdx;
          return (
            <div key={s} className="flex flex-col items-center">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-full border-4 border-surface text-xs font-semibold ${
                  done || current ? "bg-plum text-white" : "bg-surface-2 text-muted"
                } ${current ? "ring-2 ring-plum/30" : ""}`}
              >
                {done ? <Icon name="check" size={16} /> : i + 1}
              </div>
              <span
                className={`mt-1.5 text-center text-[11px] leading-tight ${
                  current ? "font-semibold text-plum" : "text-muted"
                }`}
              >
                {STATUS_LABEL[s]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <Container className="py-8 lg:py-12">
        <div className="mx-auto w-full max-w-lg">
          <div className="flex justify-center">
            <Eyebrow>আপনার অর্ডার</Eyebrow>
          </div>
          <h1 className="mt-2 text-center font-display text-2xl font-semibold text-plum sm:text-3xl">
            অর্ডার ট্র্যাকিং
          </h1>
          <div className="mt-6">{children}</div>
        </div>
      </Container>
    </div>
  );
}

export default function TrackPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-muted">লোড হচ্ছে...</div>}>
      <TrackInner />
    </Suspense>
  );
}

/**
 * A one-tap copy of a code (order uid, courier tracking number) — these get read
 * out on the phone or pasted into the courier's own tracking page, and typing a
 * 6-character code by hand is exactly where a customer gives up.
 */
function CopyLine({ label, value, showValue = false, tone = "dark" }: {
  label: string; value: string; showValue?: boolean; tone?: "dark" | "light";
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable (http, old browser) */ }
  }
  const button = (
    <button
      type="button"
      onClick={copy}
      className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-xs font-semibold transition active:scale-95 ${
        tone === "light"
          ? "bg-white/20 text-white hover:bg-white/30"
          : "bg-plum/8 text-plum hover:bg-plum/15"
      }`}
    >
      <Icon name={copied ? "check" : "copy"} size={14} />
      {copied ? "কপি হয়েছে" : label}
    </button>
  );
  if (!showValue) return button;
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-xs text-muted">{label}</div>
        <div className="wrap-break-word font-semibold tabular-nums text-foreground">{value}</div>
      </div>
      <button
        type="button"
        onClick={copy}
        aria-label="কপি করুন"
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-plum/8 text-plum transition active:scale-95"
      >
        <Icon name={copied ? "check" : "copy"} size={16} />
      </button>
    </div>
  );
}

function CopyNumber({ label, number }: { label: string; number: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(number);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  }
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-4 py-3">
      <div className="min-w-0">
        <div className="text-xs font-semibold text-muted">{label}</div>
        <div className="font-display text-2xl font-bold tabular-nums tracking-wide text-plum">
          {number}
        </div>
      </div>
      <button
        type="button"
        onClick={copy}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-plum px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-wine active:scale-95"
      >
        <Icon name={copied ? "check" : "copy"} size={14} />
        {copied ? "কপি হয়েছে" : "কপি করুন"}
      </button>
    </div>
  );
}

function PaymentNumbers({ bkash, nagad }: { bkash: string; nagad: string }) {
  // Same number for both -> show it once, merged.
  if (bkash && nagad && bkash === nagad) {
    return <CopyNumber label="বিকাশ / নগদ (সেন্ড মানি)" number={bkash} />;
  }
  return (
    <div className="space-y-2">
      {bkash && <CopyNumber label="বিকাশ (সেন্ড মানি)" number={bkash} />}
      {nagad && <CopyNumber label="নগদ (সেন্ড মানি)" number={nagad} />}
    </div>
  );
}
