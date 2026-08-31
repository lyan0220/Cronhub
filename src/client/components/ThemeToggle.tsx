import { useTheme, type ThemePref } from "../theme";
import { Monitor, Moon, Sun, type LucideIcon } from "../ui/icons";
import { cx } from "../ui/styles";

const OPTIONS: { value: ThemePref; label: string; Icon: LucideIcon }[] = [
  { value: "light", label: "浅色", Icon: Sun },
  { value: "dark", label: "深色", Icon: Moon },
  { value: "system", label: "跟随系统", Icon: Monitor },
];

export default function ThemeToggle() {
  const { pref, setPref } = useTheme();
  return (
    <div role="radiogroup" aria-label="主题"
      className="flex gap-0.5 rounded-lg border border-border bg-surface p-0.5">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={pref === value}
          aria-label={label}
          title={label}
          onClick={() => setPref(value)}
          className={cx(
            "flex flex-1 items-center justify-center rounded-md py-1.5",
            "transition-colors duration-fast ease-smooth",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
            pref === value ? "bg-panel text-fg shadow-sm" : "text-fg-subtle hover:text-fg",
          )}
        >
          <Icon className="size-4" aria-hidden />
        </button>
      ))}
    </div>
  );
}
