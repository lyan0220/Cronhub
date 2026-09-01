/** 极简 className 拼接。刻意不装 clsx —— 只需要这 3 行。 */
export const cx = (...parts: (string | false | null | undefined)[]): string =>
  parts.filter(Boolean).join(" ");

/**
 * 键盘焦点环的单一来源。所有可交互元素（按钮、菜单项、链接式控件……）统一
 * 引用这一份，保证环的粗细与强度全站一致；表单控件走 controlBase（鼠标点击
 * 也要有反馈，所以用 :focus 而非 :focus-visible）。
 */
export const focusRing = cx(
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/25",
);

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
  // /8 的环几乎不可见，鼠标点进输入框没有任何反馈；border 也一并提到 strong 档
  "focus:border-border-strong focus:outline-none focus:ring-2 focus:ring-fg/12",
  "disabled:cursor-not-allowed disabled:opacity-50",
);

export const controlError = "border-danger focus:border-danger focus:ring-danger/20";
