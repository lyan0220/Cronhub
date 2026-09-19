import type { Monitor } from "../../types";

/** 监控状态 → 徽章文案与色调。停用优先于运行状态（停用是管理动作）。 */
export function statusBadge(m: Monitor): { tone: "success" | "danger" | "warn" | "neutral"; label: string } {
  if (m.enabled !== 1) return { tone: "neutral", label: "已停用" };
  if (m.status === "down") return { tone: "danger", label: "故障" };
  if (m.status === "up") return { tone: "success", label: "正常" };
  return { tone: "warn", label: "待探测" };
}
