// 卡片 / 列表两种视图共享的取数逻辑与样式映射，避免两套展示各自漂移。
import { CircleAlert, CircleCheck, CircleX, type LucideIcon } from "../../ui/icons";
import { fmtShort, relativeTime } from "../../utils/time";
import type { Job, Run } from "../../types";

export type Line = { tone: "success" | "danger" | "muted"; text: string };

export function lastLine(job: Job, lastRun?: Run): Line | null {
  if (lastRun) {
    const when = `${fmtShort(lastRun.triggered_at)}（${relativeTime(lastRun.triggered_at)}）`;
    const how = lastRun.source === "manual" ? "手动" : "定时";
    if (lastRun.status === "failed") {
      return { tone: "danger", text: `上次 ${when} ${how}失败 · HTTP ${lastRun.http_status ?? "-"}` };
    }
    return { tone: "success", text: `上次 ${when} ${how}成功` };
  }
  // 更早于最近 50 条记录：只有 jobs.last_run_at，拿不到成败
  if (job.last_run_at) return { tone: "muted", text: `上次 ${fmtShort(job.last_run_at)}（${relativeTime(job.last_run_at)}）` };
  return null;
}

export const LINE_ICON: Record<Line["tone"], LucideIcon> = {
  success: CircleCheck, danger: CircleX, muted: CircleAlert,
};

export const LINE_CLS: Record<Line["tone"], string> = {
  success: "text-success", danger: "text-danger", muted: "text-fg-subtle",
};

/** 触发目标的单行摘要 */
export function targetOf(job: Job): string {
  return job.trigger_type === "workflow_dispatch"
    ? `${job.workflow_id} @ ${job.ref}`
    : `event: ${job.event_type}`;
}
