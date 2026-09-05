import { nextCronTime, parseCron } from "./cron";

export type Unit = "m" | "h" | "d";
export type ScheduleRule =
  | { type: "cron"; expr: string }
  | { type: "interval"; mode: "fixed"; value: number; unit: Unit }
  | { type: "interval"; mode: "random"; min: number; max: number; unit: Unit };

export const UNIT_MS: Record<Unit, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };

/** IANA 时区名是否可用（运行时全 ICU 下等价于该时区是否存在） */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function validateSchedule(input: unknown): { ok: true; rule: ScheduleRule } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null) return { ok: false, error: "调度规则必须是 JSON 对象" };
  const r = input as Record<string, unknown>;
  if (r.type === "cron") {
    if (typeof r.expr !== "string" || !r.expr.trim()) return { ok: false, error: "cron 表达式缺失" };
    try {
      parseCron(r.expr);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    return { ok: true, rule: { type: "cron", expr: r.expr.trim() } };
  }
  if (r.type === "interval") {
    const unit = r.unit as Unit;
    if (!UNIT_MS[unit]) return { ok: false, error: "间隔单位必须是 m / h / d" };
    if (r.mode === "fixed") {
      const value = Number(r.value);
      if (!Number.isInteger(value) || value < 1 || value > 1000) return { ok: false, error: "间隔值必须是 1-1000 的整数" };
      return { ok: true, rule: { type: "interval", mode: "fixed", value, unit } };
    }
    if (r.mode === "random") {
      const min = Number(r.min), max = Number(r.max);
      if (!Number.isFinite(min) || !Number.isFinite(max) || min < 1 || min > 100_000 || max > 100_000 || max < min)
        return { ok: false, error: "随机间隔需满足 1 ≤ min ≤ max ≤ 100000" };
      return { ok: true, rule: { type: "interval", mode: "random", min, max, unit } };
    }
    return { ok: false, error: "间隔模式必须是 fixed / random" };
  }
  return { ok: false, error: "调度类型必须是 cron / interval" };
}

export function computeNextRun(rule: ScheduleRule, plannedAt: number, rand: () => number = Math.random, tz?: string): number {
  if (rule.type === "cron") return nextCronTime(rule.expr, plannedAt, tz);
  const ms = UNIT_MS[rule.unit];
  if (rule.mode === "fixed") return plannedAt + rule.value * ms;
  return plannedAt + (rule.min + rand() * (rule.max - rule.min)) * ms;
}

const UNIT_NAME: Record<Unit, string> = { m: "分钟", h: "小时", d: "天" };

export function describeSchedule(rule: ScheduleRule): string {
  if (rule.type === "cron") return `cron ${rule.expr}`;
  if (rule.mode === "fixed") return `每 ${rule.value} ${UNIT_NAME[rule.unit]}`;
  return `每 ${rule.min}~${rule.max} ${UNIT_NAME[rule.unit]}（随机）`;
}

export function previewRuns(rule: ScheduleRule, count = 5, tz?: string): number[] {
  const out: number[] = [];
  let t = Date.now();
  for (let i = 0; i < count; i++) {
    t = computeNextRun(rule, t, Math.random, tz);
    out.push(t);
  }
  return out;
}
