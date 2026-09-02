import { useState } from "react";
import { errText, post } from "../api";
import { Button, Dialog, Field, Input } from "../ui";

type Props = { open: boolean; onClose: () => void };

/**
 * 修改管理员密码。改密成功后当前会话会随 epoch 失效，
 * 提示一句后跳回登录页重新登录。
 */
export default function PasswordDialog({ open, onClose }: Props) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldErr, setFieldErr] = useState<{ current?: string; next?: string; confirm?: string }>({});
  const [formErr, setFormErr] = useState("");
  const [done, setDone] = useState(false);

  function close() {
    onClose();
    setCurrent(""); setNext(""); setConfirm("");
    setFieldErr({}); setFormErr(""); setDone(false); setBusy(false);
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const errs: typeof fieldErr = {};
    if (!current) errs.current = "请输入当前密码";
    if (next.length < 8) errs.next = "新密码至少 8 位";
    if (next.length > 100) errs.next = "新密码过长（≤100 位）";
    if (next !== confirm) errs.confirm = "两次输入的新密码不一致";
    setFieldErr(errs);
    setFormErr("");
    if (Object.values(errs).some(Boolean)) return;
    setBusy(true);
    try {
      await post("/api/password", { current, next });
      setDone(true);
      setTimeout(() => { location.href = "/login"; }, 1200);
    } catch (err) {
      setFormErr(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={close} title="修改管理员密码" width="max-w-sm"
      footer={!done && (
        <>
          <Button variant="secondary" onClick={close}>取消</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>确认修改</Button>
        </>
      )}>
      {done ? (
        <p className="text-success">密码已修改，正在跳转到登录页…</p>
      ) : (
        <form onSubmit={submit} noValidate>
          <Field label="当前密码" error={fieldErr.current ?? null}>
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} type="password" autoComplete="current-password"
                invalid={!!fieldErr.current} value={current}
                onChange={e => setCurrent(e.target.value)} />
            )}
          </Field>
          <Field label="新密码" hint="至少 8 位" error={fieldErr.next ?? null}>
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} type="password" autoComplete="new-password"
                invalid={!!fieldErr.next} value={next}
                onChange={e => setNext(e.target.value)} />
            )}
          </Field>
          <Field label="确认新密码" error={fieldErr.confirm ?? null}>
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} type="password" autoComplete="new-password"
                invalid={!!fieldErr.confirm} value={confirm}
                onChange={e => setConfirm(e.target.value)} />
            )}
          </Field>
          {formErr && (
            <p role="alert" className="mt-1 text-xs text-danger">{formErr}</p>
          )}
        </form>
      )}
    </Dialog>
  );
}
