import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  tone?: "danger" | "primary";
};

type Resolver = (ok: boolean) => void;

const Ctx = createContext<(opts: ConfirmOptions) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(Ctx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<Resolver | null>(null);

  const confirm = useCallback((o: ConfirmOptions) => {
    setOpts(o);
    return new Promise<boolean>(resolve => { resolver.current = resolve; });
  }, []);

  const settle = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpts(null);
  }, []);

  return (
    <Ctx.Provider value={confirm}>
      {children}
      <Dialog
        open={opts !== null}
        onClose={() => settle(false)}
        title={opts?.title ?? ""}
        footer={
          <>
            <Button variant="secondary" onClick={() => settle(false)}>
              {opts?.cancelText ?? "取消"}
            </Button>
            <Button variant={opts?.tone === "danger" ? "danger" : "primary"} onClick={() => settle(true)}>
              {opts?.confirmText ?? "确定"}
            </Button>
          </>
        }
      >
        {opts?.description}
      </Dialog>
    </Ctx.Provider>
  );
}
