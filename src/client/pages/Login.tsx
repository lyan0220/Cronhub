import { useState } from "react";
import { post } from "../api";
import ThemeToggle from "../components/ThemeToggle";
import { Button, Field, Input } from "../ui";
import { KeyRound } from "../ui/icons";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shaking, setShaking] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post("/api/auth/login", { password });
      location.href = "/";
    } catch (err) {
      setError((err as Error).message);
      setShaking(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface text-fg">
      <div className="flex justify-end p-4">
        <ThemeToggle />
      </div>

      <div className="flex flex-1 items-start justify-center px-4 pb-24 sm:items-center sm:pb-32">
        <form
          onSubmit={submit}
          onAnimationEnd={() => setShaking(false)}
          className={shaking ? "w-full max-w-80 animate-shake" : "w-full max-w-80"}
        >
          <div className="rounded-2xl border border-border bg-panel p-7 shadow-sm">
            <div className="mb-6 flex flex-col items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-fg text-surface">
                <KeyRound className="size-5" />
              </div>
              <div className="text-center">
                <h1 className="text-base font-semibold">Actions Cronhub</h1>
                <p className="mt-0.5 text-xs text-fg-muted">输入管理密码以继续</p>
              </div>
            </div>

            <Field label="管理密码" error={error || null}>
              {({ id, describedBy }) => (
                <Input id={id} type="password" autoFocus autoComplete="current-password"
                  aria-describedby={describedBy} invalid={!!error}
                  value={password} onChange={e => setPassword(e.target.value)} />
              )}
            </Field>

            <Button type="submit" variant="primary" className="w-full" loading={busy}
              disabled={password.length === 0}>登录</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
