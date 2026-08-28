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

export function nextCronTime(expr: string, fromMs: number): number {
  const f = parseCron(expr);
  const d = new Date(fromMs);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1); // 从下一分钟整开始
  const limit = d.getTime() + 366 * 24 * 60 * 60_000;
  for (; d.getTime() <= limit; d.setMinutes(d.getMinutes() + 1)) {
    if (!f.months.has(d.getUTCMonth() + 1)) continue;
    const domMatch = f.doms === null || f.doms.has(d.getUTCDate());
    const dowMatch = f.dows === null || f.dows.has(d.getUTCDay());
    const dayOk = f.doms !== null && f.dows !== null ? domMatch || dowMatch : domMatch && dowMatch;
    if (dayOk && f.hours.has(d.getUTCHours()) && f.minutes.has(d.getUTCMinutes())) {
      return d.getTime();
    }
  }
  throw new Error(`cron 表达式在 366 天内无匹配时间: "${expr}"`);
}
