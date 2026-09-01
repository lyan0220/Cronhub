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
  // 聚焦强调主要靠边框（fg/60 在明暗下都是清晰可见的一档），环只做柔光陪衬
  "focus:border-fg/60 focus:outline-none focus:ring-2 focus:ring-fg/12",
  "disabled:cursor-not-allowed disabled:opacity-50",
);

export const controlError = "border-danger focus:border-danger focus:ring-danger/25";

/**
 * 无文字的动作图标按钮（播放/编辑/删除这类行内操作），size-8 与 sm 按钮同高。
 * 按语义拆成四个变体（中性/成功/信息/危险），hover 底色与文字色成对出现。
 * 变体必须从不含 hover 色的基类分叉，不能用 cx 在变体上再叠 hover:* 去覆盖
 * —— 同优先级类的胜负取决于 Tailwind 输出顺序，不可预期。
 */
const iconActionBase = cx(
  "inline-flex size-8 shrink-0 items-center justify-center rounded-md",
  "transition-colors duration-fast ease-smooth",
  "disabled:cursor-not-allowed disabled:opacity-50",
  focusRing,
);

export const iconAction = cx(
  iconActionBase,
  "text-fg-muted hover:bg-panel-hover hover:text-fg",
);

export const iconActionSuccess = cx(
  iconActionBase,
  "text-fg-muted hover:bg-success/15 hover:text-success",
);

export const iconActionInfo = cx(
  iconActionBase,
  "text-fg-muted hover:bg-info/15 hover:text-info",
);

export const iconActionDanger = cx(
  iconActionBase,
  "text-fg-muted hover:bg-danger/20 hover:text-danger",
);

/**
 * bare 控件：去掉边框/底色/圆角的「裸」控件，用于嵌入组合控件（如调度编辑器的
 * 连体输入组）——外层容器自己负责边框与 focus-within 强调。不从 controlBase 用
 * cx 叠加去覆盖：本项目没装 tailwind-merge，同属性类叠加的胜负取决于 CSS 输出
 * 顺序而非书写顺序，不可预期，所以单独声明一份。
 */
export const bareBase = cx(
  "w-full px-3 py-2 text-sm text-fg placeholder:text-fg-subtle",
  "transition-colors duration-fast ease-smooth focus:outline-none",
  "disabled:cursor-not-allowed disabled:opacity-50",
);
