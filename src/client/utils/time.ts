export const fmtTime = (ms?: number | null): string =>
  ms ? new Date(ms).toLocaleString("zh-CN", { hour12: false }) : "-";

/** MM-DD HH:mm，用于列表里的紧凑显示 */
export function fmtShort(ms?: number | null): string {
  if (!ms) return "-";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---- 指定时区的时间显示：任务调度相关时间按任务生效时区展示（如 UTC 任务的
// 「下次运行」直接显示 UTC 时刻），与本机时区无关。tz 为空 = 本机时区。 ----

const tzFmtCache = new Map<string, Intl.DateTimeFormat>();

type TzParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function tzParts(ms: number, tz: string): TzParts {
  let f = tzFmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    tzFmtCache.set(tz, f);
  }
  const out = {} as Record<string, number>;
  for (const p of f.formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out as unknown as TzParts;
}

/** fmtShort 的时区变体：MM-DD HH:mm，按指定 IANA 时区显示 */
export function fmtShortTz(ms: number | null | undefined, tz?: string | null): string {
  if (!ms) return "-";
  if (!tz) return fmtShort(ms);
  const t = tzParts(ms, tz);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(t.month)}-${p(t.day)} ${p(t.hour)}:${p(t.minute)}`;
}

/** fmtTime 的时区变体：YYYY/M/D HH:mm:ss，按指定 IANA 时区显示 */
export function fmtTimeTz(ms: number | null | undefined, tz?: string | null): string {
  if (!ms) return "-";
  if (!tz) return fmtTime(ms);
  const t = tzParts(ms, tz);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.year}/${t.month}/${t.day} ${p(t.hour)}:${p(t.minute)}:${p(t.second)}`;
}

const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

/** 相对时间。now 参数仅供测试注入。 */
export function relativeTime(ms: number | null | undefined, now: number = Date.now()): string {
  if (!ms) return "-";
  const diff = ms - now;
  const abs = Math.abs(diff);
  const future = diff > 0;
  if (abs < MIN) return future ? "即将" : "刚刚";
  const [n, unit] =
    abs < HOUR ? [Math.floor(abs / MIN), "分钟"] :
    abs < DAY  ? [Math.floor(abs / HOUR), "小时"] :
                 [Math.floor(abs / DAY), "天"];
  return `${n} ${unit}${future ? "后" : "前"}`;
}
