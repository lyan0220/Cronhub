/** 极简 className 拼接。刻意不装 clsx —— 只需要这 3 行。 */
export const cx = (...parts: (string | false | null | undefined)[]): string =>
  parts.filter(Boolean).join(" ");

/**
 * 所有表单控件共用。收口原先散在 Jobs / Accounts / Login 三处的 inputCls。
 * 注意：宽度由外层容器控制（如 `<div className="w-56">`），不要靠 className 去覆盖
 * 这里已声明的属性 —— cx 只做字符串拼接，胜负取决于 Tailwind 输出的 CSS 顺序而非
 * class 串顺序，本项目又刻意没装 tailwind-merge，覆盖结果不可预期。
 */
export const controlBase = cx(
  "w-full rounded-lg border border-border bg-panel px-3 py-2 text-sm text-fg",
  "placeholder:text-fg-subtle",
  "transition-colors duration-fast ease-smooth",
  "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30",
  "disabled:cursor-not-allowed disabled:opacity-50",
);

export const controlError = "border-danger focus:border-danger focus:ring-danger/30";
