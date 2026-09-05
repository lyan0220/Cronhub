import type { Schedule } from "../../types";

export const EMPTY_SCHEDULE: Schedule = { type: "interval", mode: "fixed", value: 45, unit: "m" };

const UNIT_NAME: Record<string, string> = { m: "分钟", h: "小时", d: "天" };

/** 本机时区（新建任务时区下拉的默认值） */
export const LOCAL_TZ: string = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** 常用时区：每个代表性 UTC 偏移只保留一个（东八区统一用 Asia/Shanghai），中文城市做紧凑标签 */
const COMMON_TZS: Array<{ value: string; city: string }> = [
  { value: "Asia/Shanghai", city: "上海" },
  { value: "Asia/Tokyo", city: "东京" },
  { value: "Europe/London", city: "伦敦" },
  { value: "America/New_York", city: "纽约" },
  { value: "America/Los_Angeles", city: "洛杉矶" },
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

/** IANA 名称的尾段城市名（America/New_York → "New York"），用于非常用时区的紧凑标签 */
function shortCity(tz: string): string {
  const last = tz.split("/").pop()?.replace(/_/g, " ") ?? "";
  return last || tz;
}

/**
 * 时区下拉选项。紧凑标签适配连体输入组的 2:1 固定宽度：常用时区用中文城市 +
 * 当前偏移（上海 UTC+8）；本机/当前选中值不在常用列表时置顶补充，标签只带
 * 城市名与角色（Hong Kong · 本机），偏移省略以保证完整名放得下。完整 IANA
 * 名称在预览标题（未来触发时间（Asia/Shanghai））与任务列表里展示。
 */
export function timezoneOptions(current?: string): { value: string; label: string }[] {
  const label = (tz: string, tag = ""): string => {
    if (tz === "UTC") return "UTC";
    const known = COMMON_TZS.find((t) => t.value === tz);
    const city = known ? known.city : shortCity(tz);
    if (tag) return `${city}·${tag}`;
    const off = tzOffset(tz);
    return `${city}${off ? ` ${off}` : ""}`;
  };
  const opts = [
    { value: "UTC", label: "UTC" },
    ...COMMON_TZS.map((t) => ({ value: t.value, label: label(t.value) })),
  ];
  const extras = [...new Set([LOCAL_TZ, current || ""].filter(
    (tz) => tz && tz !== "UTC" && !COMMON_TZS.some((c) => c.value === tz),
  ))];
  for (const tz of extras) {
    const tag = tz === LOCAL_TZ ? "本机" : "当前";
    opts.unshift({ value: tz, label: label(tz, tag) });
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
