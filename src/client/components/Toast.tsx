import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { CircleCheck, CircleX, X } from "../ui/icons";
import { cx } from "../ui/styles";

type Kind = "ok" | "err";
type ToastItem = { id: number; message: string; kind: Kind };

const Ctx = createContext<(message: string, kind?: Kind) => void>(() => {});
export const useToast = () => useContext(Ctx);

// 递增序号做 id。原先用 Date.now() + Math.random()，在 1.7e12 量级上 double
// 只剩约 2^-11 的小数分辨率，同一毫秒内连弹两条有千分之几的概率撞同一个 id，
// 撞上就是 React key 重复 + 关一条连带关掉另一条。
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  // 手动关闭时要把自动消失的定时器一并清掉，否则 3 秒后它还会再跑一次
  // dismiss，filter 返回新数组引用，白白触发一轮 provider 子树重渲染。
  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t !== undefined) {
      clearTimeout(t);
      timers.current.delete(id);
    }
    setItems(prev => prev.filter(x => x.id !== id));
  }, []);

  const push = useCallback((message: string, kind: Kind = "ok") => {
    const id = ++seq;
    setItems(prev => [...prev, { id, message, kind }]);
    timers.current.set(id, setTimeout(() => dismiss(id), 3000));
  }, [dismiss]);

  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" aria-atomic="false"
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col gap-2">
        {items.map(t => (
          <div key={t.id}
            className={cx(
              "animate-in-pop pointer-events-auto flex max-w-sm items-start gap-2.5",
              "rounded-lg border px-3.5 py-2.5 text-sm shadow-lg",
              t.kind === "ok"
                ? "border-success/30 bg-success-soft text-success"
                : "border-danger/30 bg-danger-soft text-danger",
            )}
          >
            {t.kind === "ok"
              ? <CircleCheck className="mt-px size-4 shrink-0" aria-hidden />
              : <CircleX className="mt-px size-4 shrink-0" aria-hidden />}
            <span className="min-w-0 flex-1 wrap-break-word">{t.message}</span>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="关闭提示"
              className={cx(
                "-m-1 shrink-0 rounded p-1 opacity-60 transition-opacity duration-fast hover:opacity-100",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:opacity-100",
              )}>
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
