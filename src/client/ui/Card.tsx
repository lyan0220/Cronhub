import type { ReactNode } from "react";
import { cx } from "./styles";

type Props = { interactive?: boolean; className?: string; children: ReactNode };

export function Card({ interactive, className, children }: Props) {
  return (
    <div className={cx(
      "rounded-xl border border-border bg-panel",
      // 悬停只改颜色，不做位移抬升 —— 密集列表里逐个跳动是视觉噪音
      interactive && "transition-colors duration-fast ease-smooth hover:border-border-strong hover:bg-panel-hover",
      className,
    )}>
      {children}
    </div>
  );
}
