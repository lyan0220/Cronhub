import { Badge, Card, Switch, iconActionDanger, iconActionInfo, iconActionSuccess } from "../../ui";
import { Activity, Globe, LoaderCircle, Pencil, Play, Timer, Trash2 } from "../../ui/icons";
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

export default function MonitorCard({ monitor: m, beats, probing, onToggle, onProbe, onEdit, onRemove, onDetail }: Props) {
  const badge = statusBadge(m);
  return (
    // 卡片内有按钮，整卡 hover 只提边框不做底色变化，避免噪音
    <Card className="flex flex-col gap-2.5 p-4 transition-colors duration-fast ease-smooth hover:border-border-strong">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium text-fg">{m.name}</span>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>

      <div className="flex items-center gap-2 text-xs text-fg-muted">
        <Globe className="size-3.5 shrink-0" aria-hidden />
        <a href={m.url} target="_blank" rel="noreferrer" title={m.url}
          className="min-w-0 truncate font-mono transition-colors duration-fast ease-smooth hover:text-fg">
          {m.url}
        </a>
      </div>

      <HeartbeatBar beats={beats ?? []} slots={40} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          <Timer className="size-3.5 shrink-0" aria-hidden />每 {Math.round(m.interval_seconds / 60)} 分钟
        </span>
        {m.pause_start && m.pause_end && (
          <span className="text-fg-subtle">暂停 {m.pause_start}–{m.pause_end}</span>
        )}
        {m.uptime_24h !== null ? (
          <span className="tabular-nums">24h 在线 {m.uptime_24h}%</span>
        ) : (
          <span className="text-fg-subtle">暂无在线率数据</span>
        )}
        {m.avg_latency_24h !== null && <span className="tabular-nums">均 {m.avg_latency_24h}ms</span>}
        {m.enabled === 1 && m.next_run_at > 0 && (
          <span className="ml-auto tabular-nums text-fg-subtle">下次 {relativeTime(m.next_run_at)}</span>
        )}
      </div>

      {(m.on_down_job_name || m.on_up_job_name) && (
        <p className="truncate text-xs text-fg-subtle" title={`离线联动：${m.on_down_job_name ?? "无"} / 恢复联动：${m.on_up_job_name ?? "无"}`}>
          联动：{[m.on_down_job_name && `离线→${m.on_down_job_name}`, m.on_up_job_name && `恢复→${m.on_up_job_name}`].filter(Boolean).join("，")}
        </p>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3">
        <Switch checked={m.enabled === 1} onChange={() => onToggle()} label={`启用「${m.name}」`} />
        <div className="flex items-center gap-1">
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
      </div>
    </Card>
  );
}
