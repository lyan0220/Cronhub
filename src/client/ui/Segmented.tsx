import { cx, focusRing } from "./styles";

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
            focusRing,
            // 选中态用 fg 的浅底而不是 bg-panel：surface 容器上白底加淡阴影
            // 对比太弱，选中与否几乎看不出差别
            value === o.value
              ? "bg-fg/10 font-medium text-fg"
              : "text-fg-muted hover:bg-fg/5 hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
