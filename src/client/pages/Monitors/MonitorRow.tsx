import { Badge, Switch, iconActionDanger, iconActionInfo, iconActionSuccess } from "../../ui";
import { Activity, LoaderCircle, Pencil, Play, Trash2 } from "../../ui/icons";
import { cx } from "../../ui/styles";
import type { Heartbeat, Monitor } from "../../types";
import { relativeTime } from "../../utils/time";
import HeartbeatBar from "./HeartbeatBar";
import { statusBadge } from "./shared";

type Props = {
  monitor: Monitor;
  /** 该监控最近的心跳（旧→新）；首屏未拉到前为 undefined */
  beats?: Heartbeat[];
  probing: boolean;
  onToggle: () => void;
  onProbe: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onDetail: () => void;
};

/** 列表视图：表格行，信息密度高于卡片网格 */
export default function MonitorRow({ monitor: m, beats, probing, onToggle, onProbe, onEdit, onRemove, onDetail }: Props) {
  const badge = statusBadge(m);
  return (
    <tr className={cx(
      "border-b border-border/60 last:border-0",
      "transition-colors duration-fast ease-smooth hover:bg-panel-hover",
    )}>
      <td className="py-2.5 pl-4 pr-3">
        <div className="max-w-48 truncate font-medium text-fg">{m.name}</div>
        <a href={m.url} target="_blank" rel="noreferrer" title={`${m.url}（新标签页打开）`}
          className="mt-0.5 max-w-48 truncate font-mono text-xs text-fg-subtle transition-colors duration-fast ease-smooth hover:text-fg">
          {m.url}
        </a>
      </td>
      <td className="p-3 text-center"><Badge tone={badge.tone}>{badge.label}</Badge></td>
      <td className="p-3"><HeartbeatBar beats={beats ?? []} slots={28} /></td>
      <td className="p-3 text-xs whitespace-nowrap tabular-nums">
        {m.uptime_24h !== null ? (
          <>
            <div className="text-fg">在线 {m.uptime_24h}%</div>
            {m.avg_latency_24h !== null && <div className="mt-0.5 text-fg-subtle">均 {m.avg_latency_24h}ms</div>}
          </>
        ) : (
          <span className="text-fg-subtle">—</span>
        )}
      </td>
      <td className="p-3 text-xs whitespace-nowrap">
        <div className="text-fg-muted">每 {Math.round(m.interval_seconds / 60)} 分钟</div>
        {m.enabled === 1 ? (
          <div className="mt-0.5 tabular-nums text-fg-muted">
            下次 <span className="text-fg-subtle">{relativeTime(m.next_run_at)}</span>
          </div>
        ) : (
          <div className="mt-0.5 text-fg-subtle">—</div>
        )}
      </td>
      <td className="p-3">
        <div className="flex justify-center">
          <Switch checked={m.enabled === 1} onChange={() => onToggle()} label={`启用「${m.name}」`} />
        </div>
      </td>
      <td className="py-2.5 pr-3 pl-3">
        {/* 详情/检测/编辑语义配色：蓝/绿/红，与卡片视图一致 */}
        <div className="flex items-center justify-center gap-1">
          <button type="button" className={iconActionInfo} aria-label="查看详情" title="查看详情" onClick={onDetail}>
            <Activity className="size-4" aria-hidden />
          </button>
          <button type="button" className={iconActionSuccess} aria-label="立即检测" title="立即检测"
            disabled={probing} onClick={onProbe}>
            {probing
              ? <LoaderCircle className="size-4 animate-spin" aria-hidden />
              : <Play className="size-4" aria-hidden />}
          </button>
          <button type="button" className={iconActionInfo} aria-label="编辑" title="编辑" onClick={onEdit}>
            <Pencil className="size-4" aria-hidden />
          </button>
          <button type="button" className={iconActionDanger} aria-label="删除" title="删除" onClick={onRemove}>
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
      </td>
    </tr>
  );
}
