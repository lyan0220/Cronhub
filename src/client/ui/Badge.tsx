import type { ReactNode } from "react";
import { cx } from "./styles";

type Tone = "success" | "danger" | "warn" | "neutral";

const TONES: Record<Tone, string> = {
  success: "bg-success-soft text-success",
  danger: "bg-danger-soft text-danger",
  warn: "bg-warn-soft text-warn",
  neutral: "bg-panel-hover text-fg-muted",
};

export function Badge({ tone = "neutral", icon, children }:
  { tone?: Tone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={cx(
      "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
      TONES[tone],
    )}>
      {icon}
      {children}
    </span>
  );
}
