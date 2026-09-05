import { cx, focusRing } from "./styles";

type Props = {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
};

/** 多选场景的复选框（Switch 是单值开关，多选列表用这个） */
export function Checkbox({ checked, onChange, disabled, children }: Props) {
  return (
    <label className={cx(
      "flex min-w-0 cursor-pointer items-center gap-2.5",
      disabled && "cursor-default opacity-50",
    )}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)}
        className={cx("size-4 shrink-0 rounded border-border accent-fg", focusRing)} />
      <span className="min-w-0 truncate text-sm text-fg">{children}</span>
    </label>
  );
}
