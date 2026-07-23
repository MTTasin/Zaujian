import { cn } from "@/lib/cn";

export function StickyActionBar({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur",
        "px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]",
        className,
      )}
    >
      <div className="mx-auto flex max-w-6xl items-center gap-3">{children}</div>
    </div>
  );
}
