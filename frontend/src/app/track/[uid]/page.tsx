"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Container } from "@/components/ui/Container";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Icon } from "@/components/ui/Icon";
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
  pending_payment: "পেমেন্টের অপেক্ষায়",
  confirmed: "নিশ্চিত হয়েছে",
  in_production: "তৈরি হচ্ছে",
  shipped: "পাঠানো হয়েছে",
  delivered: "পৌঁছেছে",
  cancelled: "বাতিল",
};
const STATUS_TONE: Record<string, "gold" | "success" | "error" | "neutral"> = {
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

  const needPayment = order.advance_required && !submitted && order.status === "pending_payment";
  const stepIdx = STEPS.indexOf(order.status);
  const cancelled = order.status === "cancelled";

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

        <div className="rounded-2xl bg-surface p-5 text-center shadow-sm ring-1 ring-border">
          <p className="text-sm text-muted">অর্ডার কোড</p>
          <p className="mt-1 font-display text-2xl font-bold tracking-widest text-plum">{order.uid}</p>
          <div className="mt-2 flex justify-center">
            <Badge tone={STATUS_TONE[order.status] ?? "neutral"}>
              {STATUS_LABEL[order.status] ?? order.status}
            </Badge>
          </div>
          {order.steadfast_tracking_code && (
            <p className="mt-2 text-xs text-muted">ট্র্যাকিং: {order.steadfast_tracking_code}</p>
          )}
        </div>

        {/* Progress tracker */}
        {!cancelled && (
          <div className="rounded-2xl bg-surface p-5 shadow-sm ring-1 ring-border">
            <div className="flex justify-between">
              {STEPS.map((s, i) => (
                <div key={s} className="flex flex-1 flex-col items-center">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold ${
                      i <= stepIdx ? "bg-plum text-white" : "bg-surface-2 text-muted"
                    }`}
                  >
                    {i < stepIdx ? <Icon name="check" size={16} /> : i + 1}
                  </div>
                  <span className="mt-1.5 text-center text-[10px] leading-tight text-muted">
                    {STATUS_LABEL[s]}
                  </span>
                </div>
              ))}
            </div>
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

        {submitted && order.status === "pending_payment" && (
          <div className="flex items-center justify-center gap-2 rounded-2xl bg-surface p-4 text-center text-sm shadow-sm ring-1 ring-border">
            <span className="text-success"><Icon name="check" size={18} /></span>
            পেমেন্ট তথ্য পেয়েছি, যাচাই চলছে।
          </div>
        )}

        {/* Items */}
        <div className="rounded-2xl bg-surface p-5 shadow-sm ring-1 ring-border">
          <h2 className="mb-3 font-display text-base font-semibold text-foreground">আপনার পণ্য</h2>
          {order.items.map((it) => (
            <div key={it.id} className="flex gap-3 border-b border-border py-3 last:border-0">
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-surface-2">
                {it.preview_image ? (
                  <Image src={mediaUrl(it.preview_image)} alt="" fill sizes="56px" className="object-cover" />
                ) : (
                  <span className="flex h-full items-center justify-center text-plum/25">
                    <Icon name="image" size={20} />
                  </span>
                )}
              </div>
              <div className="flex-1 text-sm">
                <div className="font-semibold text-foreground">{it.product_name}</div>
                {it.config_display?.map((c, i) => (
                  <div key={i} className="text-xs text-muted">{c.label}: {c.value}</div>
                ))}
              </div>
              <PriceTag price={it.price_snapshot} size="sm" />
            </div>
          ))}
          <div className="mt-3 flex items-center justify-between">
            <span className="font-display text-base font-semibold text-foreground">মোট</span>
            <PriceTag price={order.total} size="md" />
          </div>
        </div>

        <Link
          href="/"
          className="block text-center text-sm font-semibold text-plum hover:text-gold"
        >
          হোমে ফিরুন
        </Link>
      </div>
    </Shell>
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
