import { cx } from "./styles";

type Props<T extends string> = {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  /** 给读屏软件用，如「调度类型」 */
  label: string;
};

export function Segmented<T extends string>({ value, onChange, options, label }: Props<T>) {
  return (
    <div role="radiogroup" aria-label={label}
      className="inline-flex gap-0.5 rounded-lg border border-border bg-surface p-0.5">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded-md px-3 py-1.5 text-sm whitespace-nowrap",
            "transition-colors duration-fast ease-smooth",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
            value === o.value ? "bg-panel font-medium text-fg shadow-sm" : "text-fg-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
