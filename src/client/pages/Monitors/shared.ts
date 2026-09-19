import type { Monitor } from "../../types";

/** 监控状态 → 徽章文案与色调。停用优先于运行状态（停用是管理动作）。 */
export function statusBadge(m: Monitor): { tone: "success" | "danger" | "warn" | "neutral"; label: string } {
  if (m.enabled !== 1) return { tone: "neutral", label: "已停用" };
  if (isPausedNow(m)) return { tone: "neutral", label: "暂停中" };
  if (m.status === "down") return { tone: "danger", label: "故障" };
  if (m.status === "up") return { tone: "success", label: "正常" };
  return { tone: "warn", label: "待探测" };
}

const minuteFmtCache = new Map<string, Intl.DateTimeFormat>();

/** 指定时区下 now 的本地钟点（当日 0 点起的分钟数）；时区名非法返回 null */
function tzMinuteOfDay(now: number, tz?: string | null): number | null {
  const key = tz || "UTC";
  let fmt = minuteFmtCache.get(key);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat("en-US", { timeZone: key, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
      minuteFmtCache.set(key, fmt);
    } catch {
      return null;
    }
  }
  const [h, m] = fmt.format(new Date(now)).split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

function hhmmMinute(v: string | null): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v ?? "");
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h <= 23 && min <= 59 ? h * 60 + min : null;
}

/** 当前是否处于暂停窗口（跨天窗口已处理；起止相同视为零长不暂停） */
export function isPausedNow(m: Monitor, now = Date.now()): boolean {
  if (m.enabled !== 1) return false;
  const start = hhmmMinute(m.pause_start);
  const end = hhmmMinute(m.pause_end);
  if (start === null || end === null || start === end) return false;
  const cur = tzMinuteOfDay(now, m.timezone);
  if (cur === null) return false;
  return start < end ? cur >= start && cur < end : cur >= start || cur < end;
}
