import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "./icons";
import { cx, focusRing } from "./styles";

export type MenuItem = {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  tone?: "danger";
};

export function Menu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  /** 键盘打开时待执行的移动方向：1 落到首项，-1 落到末项，0 不动（鼠标打开）。 */
  const pending = useRef(0);

  /** 在菜单项间循环移动焦点。焦点不在菜单内时，按方向落到首项 / 末项。 */
  const moveFocus = useCallback((delta: number) => {
    const nodes = list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    if (!nodes || nodes.length === 0) return;
    const arr = Array.from(nodes);
    const cur = arr.indexOf(document.activeElement as HTMLButtonElement);
    const next = cur < 0 ? (delta > 0 ? 0 : arr.length - 1) : (cur + delta + arr.length) % arr.length;
    arr[next].focus();
  }, []);

  /** 关闭菜单；returnFocus 为真时把焦点还给触发按钮（键盘路径必须还，否则焦点掉到 body）。 */
  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  }, []);

  // 点击外部与 Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // preventDefault 挡掉浏览器由这次 keydown 派生的 close request：
      // Menu 放进 Dialog / Drawer 里时，一次 Esc 否则会既关菜单又关外层弹层
      // （Drawer 脏态下还会顺带弹一次确认）。
      e.preventDefault();
      close(true);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  // 方向键打开的那一次，等菜单渲染出来后再把焦点送进去
  useEffect(() => {
    if (!open || pending.current === 0) {
      pending.current = 0;
      return;
    }
    const delta = pending.current;
    pending.current = 0;
    moveFocus(delta);
  }, [open, moveFocus]);

  return (
    <div ref={box} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        onKeyDown={e => {
          if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
          e.preventDefault();
          const delta = e.key === "ArrowDown" ? 1 : -1;
          if (open) return moveFocus(delta);
          pending.current = delta;
          setOpen(true);
        }}
        className={cx(
          "rounded-md p-1.5 text-fg-subtle transition-colors duration-fast",
          "hover:bg-panel-hover hover:text-fg",
          focusRing,
          open && "bg-panel-hover text-fg",
        )}
      >
        <MoreHorizontal className="size-4" />
      </button>

      {open && (
        <div role="menu"
          ref={list}
          onKeyDown={e => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            moveFocus(e.key === "ArrowDown" ? 1 : -1);
          }}
          className="animate-in-pop absolute right-0 z-20 mt-1 min-w-36 rounded-lg border border-border bg-panel p-1 shadow-lg">
          {items.map(it => (
            <button
              key={it.label}
              role="menuitem"
              type="button"
              // 先把焦点还给触发按钮再执行回调。菜单项自己会被卸载，不还焦点就掉到 body；
              // Esc 路径专门做了归还，Enter 选中却没做，两条键盘路径本来不一致。
              // 顺序不能反：onSelect 可能打开抽屉并抢走焦点，那时归还会把它抢回来。
              onClick={() => { setOpen(false); trigger.current?.focus(); it.onSelect(); }}
              className={cx(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm",
                "transition-colors duration-fast hover:bg-panel-hover",
                focusRing,
                it.tone === "danger" ? "text-danger" : "text-fg",
              )}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
