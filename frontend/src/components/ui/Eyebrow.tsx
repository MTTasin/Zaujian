import { cn } from "@/lib/cn";

// Gold small-caps kicker with a short rule — the signature Heritage-Atelier detail.
export function Eyebrow({
  children,
  className,
  onDark = false,
}: {
  children: React.ReactNode;
  className?: string;
  onDark?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2.5 text-xs font-semibold tracking-wide",
        onDark ? "text-gold-soft" : "text-gold",
        className,
      )}
    >
      <span
        className={cn("h-px w-7", onDark ? "bg-gold-soft/70" : "bg-gold/70")}
        aria-hidden
      />
      {children}
    </span>
  );
}
