import type { Schedule } from "../../types";

export const EMPTY_SCHEDULE: Schedule = { type: "interval", mode: "fixed", value: 45, unit: "m" };

const UNIT_NAME: Record<string, string> = { m: "分钟", h: "小时", d: "天" };

/** 本机时区（新建任务时区下拉的默认值） */
export const LOCAL_TZ: string = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** 常用时区：每个代表性 UTC 偏移只保留一个（东八区统一用 Asia/Shanghai） */
const COMMON_TZS = [
  "UTC", "Asia/Shanghai", "Asia/Tokyo", "Europe/London", "America/New_York", "America/Los_Angeles",
];

/** 时区当前 UTC 偏移（如 "UTC+8"）；老运行时不支持 shortOffset 时返回 null */
function tzOffset(tz: string): string | null {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName");
    return part?.value.replace(/^GMT$/, "UTC+0").replace("GMT", "UTC") ?? null;
  } catch {
    return null;
  }
}

/**
 * 时区下拉选项：常用时区优先；本机时区与当前选中值不在常用列表时动态补充
 * （标注「本机 / 当前」），保证任何时区的机器上编辑任何任务，下拉都能匹配
 * 到当前值而不显示空白。
 */
export function timezoneOptions(current?: string): { value: string; label: string }[] {
  const optionLabel = (tz: string, suffix = ""): string => {
    if (tz === "UTC") return "UTC";
    const offset = tzOffset(tz);
    return offset ? `${tz}（${offset}${suffix}）` : `${tz}${suffix}`;
  };
  const opts = COMMON_TZS.map((tz) => ({ value: tz, label: optionLabel(tz) }));
  const extras = [...new Set([LOCAL_TZ, current || ""].filter(
    (tz) => tz && tz !== "UTC" && !COMMON_TZS.includes(tz),
  ))];
  for (const tz of extras) {
    const suffix = tz === LOCAL_TZ ? " · 本机" : " · 当前";
    opts.unshift({ value: tz, label: optionLabel(tz, suffix) });
  }
  return opts;
}

/**
 * 任务「调度相关时间」的展示时区：cron 任务按其生效时区（空 = UTC，不再换算
 * 成本机时间）；间隔任务与时区无关，保持本机时区显示。null = 用本机时区。
 */
export function displayTzOf(s: Schedule, tz?: string | null): string | null {
  return s.type === "cron" ? (tz || "UTC") : null;
}

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

/** 人类可读的调度描述。cron 标注生效时区（空/UTC 显示 UTC）。 */
export function describeLocal(s: Schedule, tz?: string | null): string {
  if (s.type === "cron") return s.expr ? `cron ${s.expr}（${tz || "UTC"}）` : `cron（${tz || "UTC"}）`;
  const u = UNIT_NAME[s.unit ?? "m"];
  if (s.mode === "random") return `每 ${s.min}~${s.max} ${u}（随机）`;
  return `每 ${s.value} ${u}`;
}
