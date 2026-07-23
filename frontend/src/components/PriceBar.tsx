"use client";

import { PriceTag } from "@/components/ui/PriceTag";

// Sticky bottom bar: always-visible running price + primary action (plan §13).
export default function PriceBar({
  price,
  actionLabel,
  onAction,
  disabled,
  busy,
}: {
  price: string | number;
  actionLabel: string;
  onAction: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const priceStr = String(price);
  // Most callers pass a clean decimal amount (PriceTag handles those). A few
  // pass a range ("500 – 1500") or a placeholder ("—") for custom-design
  // items — fall back to plain text so those still read correctly.
  const isPlainAmount = priceStr.trim() !== "" && !Number.isNaN(Number(priceStr));

  // Sits above the mobile tab bar (fixed bottom-0, ~56px) so the confirm button
  // is never hidden; flush to the bottom on sm+ where there's no tab bar.
  return (
    <div className="sticky bottom-16 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:bottom-0">
      <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3 px-4 py-3">
        <div className="leading-tight">
          <span className="block text-xs text-muted">মোট দাম</span>
          {isPlainAmount ? (
            <PriceTag price={priceStr} size="lg" />
          ) : (
            <span className="font-display text-2xl font-bold text-plum">৳ {priceStr}</span>
          )}
        </div>
        <button
          type="button"
          onClick={onAction}
          disabled={disabled || busy}
          className="inline-flex min-h-14 items-center justify-center gap-2 rounded-full bg-plum px-8 text-base font-semibold text-white transition hover:bg-wine active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? "..." : actionLabel}
        </button>
      </div>
    </div>
  );
}
