"use client";
import { cn } from "@/lib/cn";

export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = 99,
  className,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  className?: string;
}) {
  const set = (n: number) => {
    if (n < min || n > max) return;
    onChange(n);
  };
  const btn =
    "flex h-12 w-12 items-center justify-center text-xl text-plum disabled:opacity-40";
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border border-border bg-surface",
        className,
      )}
    >
      <button
        type="button"
        aria-label="কমান"
        className={btn}
        disabled={value <= min}
        onClick={() => set(value - 1)}
      >
        −
      </button>
      <span className="w-8 text-center font-semibold tabular-nums">{value}</span>
      <button
        type="button"
        aria-label="বাড়ান"
        className={btn}
        disabled={value >= max}
        onClick={() => set(value + 1)}
      >
        +
      </button>
    </div>
  );
}
