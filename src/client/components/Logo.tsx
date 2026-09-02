import { cx } from "../ui/styles";

type Props = { className?: string };

/**
 * 品牌标记：循环箭头（cron 周期调度）+ 播放三角（触发 Actions）。
 * 单色反白方块，颜色全部走 bg-fg / text-surface，明暗主题自动反转，不引入新色板。
 * 圆角用百分比（28%）随尺寸缩放：size-7 下约等于 rounded-md，size-10 下约等于 rounded-xl，
 * 调用方只需给尺寸，不需要（也不能）覆盖圆角——cx 是纯拼接，覆盖结果不可预期。
 */
export function Logo({ className }: Props) {
  return (
    <span className={cx("grid shrink-0 place-items-center rounded-[28%] bg-fg text-surface", className)}>
      {/* viewBox 32：粗「C」弧开口朝右（Cronhub），播放三角尖端探入开口（Actions 触发运行）。 */}
      <svg viewBox="0 0 32 32" className="size-[72%]" aria-hidden="true" focusable="false">
        <path d="M22.96 11.13 A8.5 8.5 0 1 0 22.96 20.87"
          fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
        <path d="M13.4 11.1 L13.4 20.9 L21.3 16 Z" fill="currentColor" />
      </svg>
    </span>
  );
}
