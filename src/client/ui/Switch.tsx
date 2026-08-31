import { cx } from "./styles";

type Props = { checked: boolean; onChange: (next: boolean) => void; disabled?: boolean; label: string };

/** 原实现是裸 <button>，读屏软件读不出状态。这里补齐 role 与 aria-checked。 */
export function Switch({ checked, onChange, disabled, label }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors duration-fast ease-smooth",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-success" : "bg-border-strong",
      )}
    >
      <span className={cx(
        "absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-sm",
        "transition-transform duration-fast ease-smooth",
        checked && "translate-x-4",
      )} />
    </button>
  );
}
