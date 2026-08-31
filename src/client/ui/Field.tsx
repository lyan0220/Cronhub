import { useId, type ReactNode } from "react";

type Props = {
  label: string;
  hint?: string;
  error?: string | null;
  children: (ids: { id: string; describedBy?: string }) => ReactNode;
};

/**
 * 表单行容器。children 是函数，把生成的 id 交给控件，
 * 保证 label 的 htmlFor 与 aria-describedby 始终串得上。
 */
export function Field({ label, hint, error, children }: Props) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy = error ? errId : hint ? hintId : undefined;
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-fg">{label}</label>
      {children({ id, describedBy })}
      {error
        ? <p id={errId} role="alert" className="mt-1.5 text-xs text-danger">{error}</p>
        : hint && <p id={hintId} className="mt-1.5 text-xs text-fg-muted">{hint}</p>}
    </div>
  );
}
