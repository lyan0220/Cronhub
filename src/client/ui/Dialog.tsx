import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "./icons";
import { cx } from "./styles";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
};

/**
 * 基于原生 <dialog>：焦点锁定、Esc 关闭、背景惰性化、::backdrop 全由浏览器提供，
 * 不需要手写焦点陷阱。
 */
export function Dialog({ open, onClose, title, children, footer, width = "max-w-md" }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  // 浏览器触发的关闭（Esc、form method=dialog）要同步回 React 状态
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onCancelOrClose = (e: Event) => { e.preventDefault(); onClose(); };
    el.addEventListener("cancel", onCancelOrClose);
    return () => el.removeEventListener("cancel", onCancelOrClose);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClick={e => { if (e.target === ref.current) onClose(); }}
      className={cx(
        "m-auto w-full rounded-xl border border-border bg-panel p-0 text-fg shadow-xl",
        "open:animate-in-pop backdrop:bg-black/50",
        width,
      )}
    >
      <div className="flex items-start justify-between gap-4 px-5 pt-5">
        <h2 id={titleId} className="text-base font-semibold">{title}</h2>
        <button type="button" onClick={onClose} aria-label="关闭"
          className={cx(
            "-m-1 rounded-md p-1 text-fg-subtle transition-colors duration-fast hover:bg-panel-hover hover:text-fg",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
          )}>
          <X className="size-4" />
        </button>
      </div>
      <div className="px-5 py-4 text-sm text-fg-muted">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
    </dialog>
  );
}
