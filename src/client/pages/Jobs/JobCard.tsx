import { Badge, Card, Switch, iconActionDanger, iconActionInfo, iconActionSuccess } from "../../ui";
import { ArrowRight, GitBranch, LoaderCircle, Pencil, Play, Timer, Trash2 } from "../../ui/icons";
import type { Job, Run } from "../../types";
import { fmtShort, relativeTime } from "../../utils/time";
import { describeLocal, parseSchedule } from "./schedule";
import { lastLine, LINE_CLS, LINE_ICON, targetOf } from "./shared";

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

/** 卡片视图：窄卡片进自适应网格，比通栏行卡片放得下更多列 */
export default function JobCard({ job, lastRun, triggering, onToggle, onTrigger, onEdit, onRemove }: Props) {
  const schedule = describeLocal(parseSchedule(job.schedule_json));
  const line = lastLine(job, lastRun);
  const LineIcon = line && LINE_ICON[line.tone];

  return (
    // 卡片内有按钮，整卡 hover 只提边框不做底色变化，避免噪音
    <Card className="flex flex-col gap-2.5 p-4 transition-colors duration-fast ease-smooth hover:border-border-strong">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium text-fg">{job.name}</span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
        <span className="inline-flex items-center gap-1.5 font-mono">
          <GitBranch className="size-3.5 shrink-0" aria-hidden />{job.repo}
        </span>
        <span className="truncate font-mono">{targetOf(job)}</span>
        <span className="shrink-0 text-fg-subtle">{job.account_name ?? "账号已删除"}</span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
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
        <div className={`inline-flex items-center gap-1.5 text-xs ${LINE_CLS[line.tone]}`}>
          <LineIcon className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 truncate tabular-nums">{line.text}</span>
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3">
        <div className="flex items-center gap-2">
          <Badge tone={job.enabled ? "success" : "neutral"}>{job.enabled ? "启用" : "停用"}</Badge>
          <Switch checked={job.enabled === 1} onChange={() => onToggle()} label={`启用「${job.name}」`} />
        </div>
        {/* 触发/编辑/删除三个动作统一为图标按钮，删除 hover 红色提醒 */}
        {/* 触发/编辑/删除语义配色：绿/蓝/红，删除 hover 红色提醒 */}
        <div className="flex items-center gap-1">
          <button type="button" className={iconActionSuccess} aria-label="立即触发" title="立即触发"
            disabled={triggering} onClick={onTrigger}>
            {triggering
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
