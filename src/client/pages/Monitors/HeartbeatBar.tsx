import { cx } from "../../ui/styles";
import { fmtTime } from "../../utils/time";
import type { Heartbeat } from "../../types";

type Props = {
  /** 旧→新排序的心跳数组；不足 slots 时左侧补空格 */
  beats: Heartbeat[];
  /** 条带格数 */
  slots?: number;
  /** 条带整体高度（Tailwind 类） */
  size?: "sm" | "lg";
  className?: string;
};

/** 心跳条带：每格一次探测，绿=成功 红=失败 灰=暂无数据，
 * 原生 title 提示详情。纯 div 实现，无图表库依赖。 */
export default function HeartbeatBar({ beats, slots = 40, size = "sm", className }: Props) {
  // 不足补位放在左侧：右侧对齐最新的探测，与时间轴方向一致
  const pad = Math.max(0, slots - beats.length);
  const shown = beats.slice(-slots);
  return (
    <div className={cx("flex w-full gap-[2px]", className)} role="img"
      aria-label={`最近 ${shown.length} 次探测，${shown.filter(b => b.status === "up").length} 次成功`}>
      {Array.from({ length: pad }, (_, i) => (
        <div key={`pad-${i}`} className="min-w-0 flex-1" />
      ))}
      {shown.map(b => (
        <div
          key={b.id}
          title={beatTitle(b)}
          className={cx(
            "min-w-0 flex-1 rounded-[2px]",
            size === "sm" ? "h-5" : "h-8",
            b.status === "up" ? "bg-success" : "bg-danger",
          )}
        />
      ))}
    </div>
  );
}

function beatTitle(b: Heartbeat): string {
  const head = `${fmtTime(b.created_at)} · ${b.status === "up" ? "成功" : "失败"}`;
  if (b.status === "up") {
    return `${head} · HTTP ${b.http_status ?? "-"} · ${b.latency_ms ?? "-"}ms`;
  }
  const detail = b.error_message ?? (b.http_status != null ? `HTTP ${b.http_status}` : "-");
  return `${head} · ${detail}`;
}
