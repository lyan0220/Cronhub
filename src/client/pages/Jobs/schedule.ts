import type { Schedule } from "../../types";

export const EMPTY_SCHEDULE: Schedule = { type: "interval", mode: "fixed", value: 45, unit: "m" };

const UNIT_NAME: Record<string, string> = { m: "分钟", h: "小时", d: "天" };

/** 解析后端存的 schedule_json。任何异常输入都兜底为 EMPTY_SCHEDULE，绝不抛错。 */
export function parseSchedule(json: string): Schedule {
  try {
    const v = JSON.parse(json) as unknown;
    if (typeof v !== "object" || v === null || Array.isArray(v)) return EMPTY_SCHEDULE;
    return v as Schedule;
  } catch {
    return EMPTY_SCHEDULE;
  }
}

/** 人类可读的调度描述。cron 明确标注 UTC，因为后端按 UTC 计算。 */
export function describeLocal(s: Schedule): string {
  if (s.type === "cron") return s.expr ? `cron ${s.expr}（UTC）` : "cron（UTC）";
  const u = UNIT_NAME[s.unit ?? "m"];
  if (s.mode === "random") return `每 ${s.min}~${s.max} ${u}（随机）`;
  return `每 ${s.value} ${u}`;
}
