"use client";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/ui/Icon";

// ---------------------------------------------------------------------------
// Shared admin UI kit — crisp neutral dashboard, plum accent, gold highlights.
// English panel (separate audience from the Bengali storefront).
// ---------------------------------------------------------------------------

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-200 bg-white shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

const STAT_TONES: Record<string, string> = {
  plum: "bg-plum/10 text-plum",
  gold: "bg-gold/15 text-gold",
  green: "bg-emerald-100 text-emerald-600",
  amber: "bg-amber-100 text-amber-600",
  blue: "bg-blue-100 text-blue-600",
  slate: "bg-slate-100 text-slate-500",
};

export function StatCard({
  label,
  value,
  icon,
  tone = "plum",
  hint,
}: {
  label: string;
  value: React.ReactNode;
  icon?: IconName;
  tone?: keyof typeof STAT_TONES;
  hint?: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-3xl font-bold tabular-nums text-slate-900">{value}</div>
          <div className="mt-1 text-sm text-slate-500">{label}</div>
          {hint && <div className="mt-1 text-xs text-amber-600">{hint}</div>}
        </div>
        {icon && (
          <span className={cn("flex h-10 w-10 items-center justify-center rounded-lg", STAT_TONES[tone])}>
            <Icon name={icon} size={20} />
          </span>
        )}
      </div>
    </Card>
  );
}

type BtnVariant = "primary" | "secondary" | "danger" | "ghost";
const BTN: Record<BtnVariant, string> = {
  primary: "bg-plum text-white hover:bg-wine",
  secondary: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
  danger: "bg-red-600 text-white hover:bg-red-700",
  ghost: "text-slate-600 hover:bg-slate-100",
};

export function AdminButton({
  variant = "primary",
  icon,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant;
  icon?: IconName;
}) {
  return (
    <button
      className={cn(
        "inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition disabled:opacity-50 disabled:pointer-events-none",
        BTN[variant],
        className,
      )}
      {...props}
    >
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

const INPUT =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-plum focus:ring-2 focus:ring-plum/20 placeholder:text-slate-400 disabled:bg-slate-50";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(INPUT, props.className)} />;
}
export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(INPUT, props.className)} />;
}
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(INPUT, props.className)} />;
}

const STATUS_TONES: Record<string, string> = {
  green: "bg-emerald-100 text-emerald-700",
  amber: "bg-amber-100 text-amber-700",
  blue: "bg-blue-100 text-blue-700",
  violet: "bg-violet-100 text-violet-700",
  indigo: "bg-indigo-100 text-indigo-700",
  red: "bg-red-100 text-red-700",
  slate: "bg-slate-100 text-slate-600",
};
const STATUS_MAP: Record<string, keyof typeof STATUS_TONES> = {
  pending_payment: "amber",
  pending: "amber",
  confirmed: "blue",
  priced: "green",
  in_production: "violet",
  shipped: "indigo",
  delivered: "green",
  cancelled: "red",
  rejected: "red",
};

export function StatusPill({ status, label }: { status: string; label?: string }) {
  const tone = STATUS_MAP[status] ?? "slate";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
        STATUS_TONES[tone],
      )}
    >
      {label ?? status}
    </span>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-slate-400">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-plum" />
      {label}
    </div>
  );
}

export function AdminEmpty({
  icon = "box",
  title,
  hint,
  action,
}: {
  icon?: IconName;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm">
        <Icon name={icon} size={24} />
      </span>
      <p className="font-semibold text-slate-700">{title}</p>
      {hint && <p className="text-sm text-slate-400">{hint}</p>}
      {action}
    </div>
  );
}

// Table helpers — consistent header/row styling.
export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}
export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={cn("bg-slate-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500", className)}>
      {children}
    </th>
  );
}
export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn("border-t border-slate-100 px-4 py-3 text-slate-700", className)}>{children}</td>;
}
