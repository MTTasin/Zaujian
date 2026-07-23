import { cn } from "@/lib/cn";

type Tone = "gold" | "rose" | "success" | "warn" | "error" | "neutral";

const TONES: Record<Tone, string> = {
  gold: "bg-gold/15 text-gold",
  rose: "bg-rose/15 text-rose",
  success: "bg-success/15 text-success",
  warn: "bg-warn/15 text-warn",
  error: "bg-error/15 text-error",
  neutral: "bg-surface-2 text-muted",
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
