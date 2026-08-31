import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CircleCheck, CircleX, X } from "../ui/icons";
import { cx } from "../ui/styles";

type Kind = "ok" | "err";
type ToastItem = { id: number; message: string; kind: Kind };

const Ctx = createContext<(message: string, kind?: Kind) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems(prev => prev.filter(t => t.id !== id));
  }, []);

  const push = useCallback((message: string, kind: Kind = "ok") => {
    const id = Date.now() + Math.random();
    setItems(prev => [...prev, { id, message, kind }]);
    setTimeout(() => dismiss(id), 3000);
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
            <span className="min-w-0 flex-1 break-words">{t.message}</span>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="关闭提示"
              className="-m-1 shrink-0 rounded p-1 opacity-60 transition-opacity duration-fast hover:opacity-100">
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
