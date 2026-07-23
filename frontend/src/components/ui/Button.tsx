import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost";
type Size = "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "brand-gradient text-white shadow-sm active:scale-[0.98]",
  secondary: "border border-plum/30 text-plum bg-surface active:scale-[0.98]",
  ghost: "text-plum bg-transparent active:bg-surface-2",
};

const SIZES: Record<Size, string> = {
  md: "min-h-12 px-5 text-sm",
  lg: "min-h-14 px-6 text-base",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  fullWidth,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-semibold",
        "transition disabled:opacity-50 disabled:pointer-events-none",
        VARIANTS[variant],
        SIZES[size],
        fullWidth && "w-full",
        className,
      )}
      {...props}
    />
  );
}
