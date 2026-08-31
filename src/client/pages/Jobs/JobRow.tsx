import { Badge, Button, Card, Menu, Switch, type MenuItem } from "../../ui";
import {
  ArrowRight, CircleAlert, CircleCheck, CircleX, GitBranch, Pencil, Play, Timer, Trash2,
} from "../../ui/icons";
import type { Job, Run } from "../../types";
import { fmtShort, relativeTime } from "../../utils/time";
import { describeLocal, parseSchedule } from "./schedule";

type Props = {
  job: Job;
  /** 最近 50 条运行记录里属于该任务的最新一条；查不到为 undefined */
  lastRun?: Run;
  triggering: boolean;
  onToggle: () => void;
  onTrigger: () => void;
  onEdit: () => void;
  onRemove: () => void;
};

type Line = { tone: "success" | "danger" | "muted"; text: string };

function lastLine(job: Job, lastRun?: Run): Line | null {
  if (lastRun) {
    const when = `${fmtShort(lastRun.triggered_at)}（${relativeTime(lastRun.triggered_at)}）`;
    const how = lastRun.source === "manual" ? "手动" : "定时";
    if (lastRun.status === "failed") {
      return { tone: "danger", text: `上次 ${when} ${how}失败 · HTTP ${lastRun.http_status ?? "-"}` };
    }
    return { tone: "success", text: `上次 ${when} ${how}成功` };
  }
  // 更早于最近 50 条记录：只有 jobs.last_run_at，拿不到成败
  if (job.last_run_at) return { tone: "muted", text: `上次 ${fmtShort(job.last_run_at)}（${relativeTime(job.last_run_at)}）` };
  return null;
}

const LINE_ICON = { success: CircleCheck, danger: CircleX, muted: CircleAlert } as const;
const LINE_CLS = { success: "text-success", danger: "text-danger", muted: "text-fg-subtle" } as const;

export default function JobRow({ job, lastRun, triggering, onToggle, onTrigger, onEdit, onRemove }: Props) {
  const target = job.trigger_type === "workflow_dispatch"
    ? `${job.workflow_id} @ ${job.ref}`
    : `event: ${job.event_type}`;
  const schedule = describeLocal(parseSchedule(job.schedule_json));
  const line = lastLine(job, lastRun);
  const LineIcon = line && LINE_ICON[line.tone];

  const items: MenuItem[] = [
    { label: "编辑", icon: <Pencil className="size-3.5" />, onSelect: onEdit },
    { label: "删除", icon: <Trash2 className="size-3.5" />, onSelect: onRemove, tone: "danger" },
  ];

  return (
    <Card interactive className="p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-0 flex-1 truncate font-medium text-fg">{job.name}</span>
        <Badge tone={job.enabled ? "success" : "neutral"}>{job.enabled ? "启用" : "停用"}</Badge>
        <Switch checked={job.enabled === 1} onChange={() => onToggle()} label={`启用「${job.name}」`} />
        <Button size="sm" variant="ghost" loading={triggering} onClick={onTrigger}
          icon={<Play className="size-3.5" />}>立即触发</Button>
        <Menu label={`「${job.name}」更多操作`} items={items} />
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
        <span className="inline-flex items-center gap-1.5 font-mono">
          <GitBranch className="size-3.5 shrink-0" aria-hidden />{job.repo}
        </span>
        <span className="font-mono">{target}</span>
        <span>{job.account_name ?? "账号已删除"}</span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
        <span className="inline-flex items-center gap-1.5">
          <Timer className="size-3.5 shrink-0" aria-hidden />{schedule}
        </span>
        {job.enabled === 1 && (
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            <ArrowRight className="size-3.5 shrink-0" aria-hidden />
            下次 {fmtShort(job.next_run_at)}
            <span className="text-fg-subtle">{relativeTime(job.next_run_at)}</span>
          </span>
        )}
      </div>

      {line && LineIcon && (
        <div className={`mt-1.5 inline-flex items-center gap-1.5 text-xs ${LINE_CLS[line.tone]}`}>
          <LineIcon className="size-3.5 shrink-0" aria-hidden />
          <span className="tabular-nums">{line.text}</span>
        </div>
      )}
    </Card>
  );
}
