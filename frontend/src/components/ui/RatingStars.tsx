import { cn } from "@/lib/cn";

export function RatingStars({
  value,
  count,
  size = "sm",
}: {
  value: number;
  count?: number;
  size?: "sm" | "md";
}) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  const text = size === "md" ? "text-lg" : "text-sm";
  return (
    <span
      className="inline-flex items-center gap-1"
      aria-label={`${value} এর মধ্যে 5`}
    >
      <span className={cn("relative inline-block leading-none", text)}>
        <span className="text-border">★★★★★</span>
        <span
          className="absolute inset-0 overflow-hidden text-gold"
          style={{ width: `${pct}%` }}
          aria-hidden
        >
          ★★★★★
        </span>
      </span>
      {typeof count === "number" && (
        <span className="text-xs text-muted">({count})</span>
      )}
    </span>
  );
}
