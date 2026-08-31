import type { ButtonHTMLAttributes, ReactNode } from "react";
import { LoaderCircle } from "./icons";
import { cx } from "./styles";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  // 主按钮近黑：浅色下深底白字，深色下反转为白底黑字
  primary: "bg-fg text-surface hover:opacity-85",
  secondary: "border border-border bg-panel text-fg hover:bg-panel-hover hover:border-border-strong",
  ghost: "text-fg-muted hover:bg-panel-hover hover:text-fg",
  danger: "border border-danger/40 bg-danger-soft text-danger hover:border-danger",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 gap-1.5 px-2.5 text-xs",
  md: "h-9 gap-2 px-3.5 text-sm",
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
};

export function Button({
  variant = "secondary", size = "md", loading = false,
  icon, children, className, disabled, type = "button", ...rest
}: Props) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-lg font-medium",
        "transition-all duration-fast ease-smooth",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant], SIZES[size], className,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}
