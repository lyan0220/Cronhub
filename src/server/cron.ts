// 5 字段 cron（分 时 日 月 周）解析与下次触发时间计算。
// 支持 *、a、a-b、a-b/n、*/n、逗号列表；星期 0-7（0 与 7 均为周日）。
// 标准语义：日(dom)与周(dow)同时受限时取“或”；时间按 UTC 计算。

export type CronFields = {
  minutes: Set<number>;
  hours: Set<number>;
  doms: Set<number> | null; // null = 字段为 *
  dows: Set<number> | null;
  months: Set<number>;
};

const RANGE: Array<[number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // dom
  [1, 12], // month
  [0, 7],  // dow
];

function parseField(field: string, idx: number): Set<number> | null {
  const [min, max] = RANGE[idx];
  const label = ["分", "时", "日", "月", "周"][idx];
  if (field === "*") return null;
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const m = part.match(/^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/);
    if (!m) throw new Error(`cron ${label}字段非法: "${part}"`);
    const step = m[4] ? Number(m[4]) : 1;
    if (step < 1) throw new Error(`cron ${label}字段步长必须≥1: "${part}"`);
    const lo = m[2] !== undefined ? Number(m[2]) : min;
    const hi = m[3] !== undefined ? Number(m[3]) : m[2] !== undefined ? Number(m[2]) : max;
    if (lo < min || hi > max || lo > hi) throw new Error(`cron ${label}字段越界: "${part}"（允许 ${min}-${max}）`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`cron 表达式必须是 5 个字段: "${expr}"`);
  const dows = parseField(parts[4], 4);
  if (dows) {
    if (dows.has(7)) dows.add(0);
    dows.delete(7);
  }
  return {
    minutes: parseField(parts[0], 0) ?? full(0),
    hours: parseField(parts[1], 1) ?? full(1),
    doms: parseField(parts[2], 2),
    months: parseField(parts[3], 3) ?? full(3),
    dows,
  };
}

function full(idx: number): Set<number> {
  const [min, max] = RANGE[idx];
  const s = new Set<number>();
  for (let v = min; v <= max; v++) s.add(v);
  return s;
}

export function nextCronTime(expr: string, fromMs: number, tz?: string): number {
  const f = parseCron(expr);
  return tz ? nextInZone(f, expr, fromMs, tz) : nextUtc(f, expr, fromMs);
}

function sorted(f: CronFields): { minutes: number[]; hours: number[] } {
  return {
    minutes: [...f.minutes].sort((a, b) => a - b),
    hours: [...f.hours].sort((a, b) => a - b),
  };
}

function nextUtc(f: CronFields, expr: string, fromMs: number): number {
  const { minutes, hours } = sorted(f);

  // 搜索起点：fromMs 截断到整分钟后 +1 分钟（严格晚于 fromMs）
  const start = new Date(fromMs);
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);
  const startDay = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const startTod = start.getTime() - startDay; // 起点在当天内的毫秒偏移

  // 逐天扫描（≤367 次循环）替代旧的逐分钟扫描（最坏 52 万次）：
  // 月/日/周不匹配的天整块跳过，只有当天命中才在 hours×minutes 里找时刻。
  const DAY = 86_400_000;
  const limitDay = startDay + 366 * DAY;
  for (let day = startDay; day <= limitDay; day += DAY) {
    const d = new Date(day);
    if (!f.months.has(d.getUTCMonth() + 1)) continue;
    const domMatch = f.doms === null || f.doms.has(d.getUTCDate());
    const dowMatch = f.dows === null || f.dows.has(d.getUTCDay());
    const dayOk = f.doms !== null && f.dows !== null ? domMatch || dowMatch : domMatch && dowMatch;
    if (!dayOk) continue;
    // 首日只找起点之后的时刻；末日与旧实现逐分钟窗口对齐（start+366 天整为止）
    const minTod = day === startDay ? startTod : 0;
    const maxTod = day === limitDay ? startTod : DAY - 60_000;
    for (const h of hours) {
      const hourMs = h * 3_600_000;
      if (hourMs + minutes[minutes.length - 1] * 60_000 < minTod) continue; // 这一小时整体已过
      const m = minutes.find((min) => {
        const tod = hourMs + min * 60_000;
        return tod >= minTod && tod <= maxTod;
      });
      if (m !== undefined) return day + hourMs + m * 60_000;
    }
  }
  throw new Error(`cron 表达式在 366 天内无匹配时间: "${expr}"`);
}

// ---- 带时区的计算：在目标时区的「墙上时间」里做同样的按天跳跃，命中后再把
// 墙上时间换算回 UTC 瞬间。墙→UTC 用两遍校验法，能正确处理任意 UTC 偏移；
// DST 缺失的墙上时间按惯例落到过渡后的最近瞬间，重复发生的时间取第一次。

type Wall = { year: number; month: number; day: number; hour: number; minute: number };

const wallFmtCache = new Map<string, Intl.DateTimeFormat>();

function wallFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = wallFmtCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    wallFmtCache.set(tz, fmt);
  }
  return fmt;
}

function wallOf(ms: number, tz: string): Wall {
  const parts = wallFormatter(tz).formatToParts(new Date(ms));
  const num = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { year: num("year"), month: num("month"), day: num("day"), hour: num("hour"), minute: num("minute") };
}

/** 某时区的墙上时刻 → UTC 毫秒。
 * 用 guess 瞬间的时区偏移反推：正常时间精确；DST 缺失的墙上时间落到过渡
 * 后的最近瞬间（如纽约 02:30 → 03:30 EDT）；DST 重复的时间取第一次出现。 */
function wallToUtc(w: Wall, tz: string): number {
  const guess = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  const back = wallOf(guess, tz);
  const asUtc = Date.UTC(back.year, back.month - 1, back.day, back.hour, back.minute);
  return guess - (asUtc - guess);
}

function nextInZone(f: CronFields, expr: string, fromMs: number, tz: string): number {
  const { minutes, hours } = sorted(f);

  // 起点墙上时刻：fromMs 的墙上分钟 +1（对齐 UTC 版本的「严格晚于」语义）
  const startWall = wallOf(fromMs, tz);
  const start = new Date(Date.UTC(startWall.year, startWall.month - 1, startWall.day, startWall.hour, startWall.minute));
  start.setUTCMinutes(start.getUTCMinutes() + 1);
  const startTod = start.getUTCHours() * 3_600_000 + start.getUTCMinutes() * 60_000;

  // 用 UTC 日历日充当「连续日历」推进天：每天的 y/m/d 与星期复用 getUTC*，
  // 只把它们当作墙上日期的标签使用。
  const DAY = 86_400_000;
  for (let prov = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()), i = 0; i <= 366; i++, prov += DAY) {
    const d = new Date(prov);
    const year = d.getUTCFullYear(), month = d.getUTCMonth() + 1, day = d.getUTCDate();
    if (!f.months.has(month)) continue;
    const domMatch = f.doms === null || f.doms.has(day);
    const dowMatch = f.dows === null || f.dows.has(d.getUTCDay());
    const dayOk = f.doms !== null && f.dows !== null ? domMatch || dowMatch : domMatch && dowMatch;
    if (!dayOk) continue;
    const minTod = i === 0 ? startTod : 0;
    for (const h of hours) {
      const hourMs = h * 3_600_000;
      if (hourMs + minutes[minutes.length - 1] * 60_000 < minTod) continue;
      const m = minutes.find((min) => hourMs + min * 60_000 >= minTod);
      if (m === undefined) continue;
      // DST 重复/缺失可能把候选换算出 <= fromMs 的瞬间，跳过该候选继续找
      const t = wallToUtc({ year, month, day, hour: h, minute: m }, tz);
      if (t > fromMs) return t;
    }
  }
  throw new Error(`cron 表达式在 366 天内无匹配时间: "${expr}"`);
}
