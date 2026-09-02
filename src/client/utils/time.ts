export const fmtTime = (ms?: number | null): string =>
  ms ? new Date(ms).toLocaleString("zh-CN", { hour12: false }) : "-";

/** MM-DD HH:mm，用于列表里的紧凑显示 */
export function fmtShort(ms?: number | null): string {
  if (!ms) return "-";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
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
