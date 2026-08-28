import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type Kind = "ok" | "err";
type ToastItem = { id: number; message: string; kind: Kind };

const Ctx = createContext<(message: string, kind?: Kind) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((message: string, kind: Kind = "ok") => {
    const id = Date.now() + Math.random();
    setItems(prev => [...prev, { id, message, kind }]);
    setTimeout(() => setItems(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="fixed right-4 bottom-4 z-50 flex flex-col gap-2">
        {items.map(t => (
          <div key={t.id} className={`rounded-lg px-4 py-2 text-sm text-white shadow-lg ${t.kind === "ok" ? "bg-emerald-600" : "bg-red-600"}`}>
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
