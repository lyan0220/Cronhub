import { useCallback, useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { useConfirm } from "./ConfirmDialog";
import { X } from "./icons";
import { cx, focusRing } from "./styles";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  /** 有未保存改动。为 true 时 Esc 与点遮罩会先二次确认。 */
  dirty?: boolean;
  children: ReactNode;
};

export function Drawer({ open, onClose, title, dirty = false, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const confirm = useConfirm();

  const attemptClose = useCallback(async () => {
    if (!dirty) return onClose();
    const ok = await confirm({
      title: "放弃未保存的改动？",
      description: "关闭后本次填写的内容不会保存。",
      confirmText: "放弃",
      tone: "danger",
    });
    if (ok) onClose();
  }, [dirty, onClose, confirm]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onCancel = (e: Event) => { e.preventDefault(); void attemptClose(); };
    el.addEventListener("cancel", onCancel);
    return () => el.removeEventListener("cancel", onCancel);
  }, [attemptClose]);

  // 卸载兜底。消费者普遍写成条件挂载（`{form && <JobForm open … />}`），于是 <dialog>
  // 带着 open 属性被 React 直接移除，close() 从未执行——而浏览器只在 close() 时把焦点
  // 还给 showModal() 之前的元素，节点被移除不触发归还，焦点会掉到 <body>，
  // Tab 得从文档顶部重新开始。
  // 必须是 useLayoutEffect：被删子树的 passive cleanup 在 DOM 移除之后才跑，
  // 那时元素已脱离文档，close() 起不到归还焦点的作用。
  useLayoutEffect(() => () => {
    const el = ref.current;
    if (el?.open) el.close();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClick={e => { if (e.target === ref.current) void attemptClose(); }}
      className={cx(
        "mr-0 ml-auto h-full max-h-full w-120 max-w-full",
        "rounded-none border-l border-border bg-panel p-0 text-fg shadow-2xl",
        "open:animate-in-right backdrop:bg-black/50",
      )}
    >
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold">{title}</h2>
          <button type="button" onClick={() => void attemptClose()} aria-label="关闭"
            className={cx(
              "-m-1 rounded-md p-1 text-fg-subtle transition-colors duration-fast hover:bg-panel-hover hover:text-fg",
              focusRing,
            )}>
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </dialog>
  );
}
