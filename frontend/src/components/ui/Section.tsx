import { cn } from "@/lib/cn";

export function Section({
  title,
  action,
  className,
  children,
}: {
  title?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("py-6", className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between">
          {title && (
            <h2 className="font-display text-xl font-bold text-plum">{title}</h2>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
