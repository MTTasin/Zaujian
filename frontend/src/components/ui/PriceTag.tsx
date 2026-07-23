import { cn } from "@/lib/cn";
import { Badge } from "./Badge";

// Prices arrive as decimal strings. Trim a trailing ".00"/".x0" for display only.
function fmt(v: string): string {
  const n = Number(v);
  if (Number.isNaN(n)) return v;
  return `৳${Number.isInteger(n) ? n : n.toFixed(2).replace(/\.?0+$/, "")}`;
}

const SIZES = { sm: "text-sm", md: "text-lg", lg: "text-2xl" } as const;

export function PriceTag({
  price,
  compareAt,
  size = "md",
  className,
}: {
  price: string;
  compareAt?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const p = Number(price);
  const c = compareAt ? Number(compareAt) : NaN;
  const discounted = !Number.isNaN(c) && c > p;
  const pct = discounted ? Math.round(((c - p) / c) * 100) : 0;
  return (
    <span className={cn("inline-flex items-baseline gap-2", className)}>
      <span className={cn("font-display font-bold text-plum", SIZES[size])}>
        {fmt(price)}
      </span>
      {discounted && (
        <>
          <span className="text-sm text-muted line-through">{fmt(compareAt!)}</span>
          <Badge tone="rose">-{pct}%</Badge>
        </>
      )}
    </span>
  );
}
