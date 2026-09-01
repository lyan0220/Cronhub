import { Badge, Button, Menu, Switch, type MenuItem } from "../../ui";
import { Pencil, Play, Trash2 } from "../../ui/icons";
import { cx } from "../../ui/styles";
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

/** 列表视图：表格行，信息密度高于卡片网格 */
export default function JobRow({ job, lastRun, triggering, onToggle, onTrigger, onEdit, onRemove }: Props) {
  const schedule = describeLocal(parseSchedule(job.schedule_json));
  const line = lastLine(job, lastRun);
  const LineIcon = line && LINE_ICON[line.tone];

  const items: MenuItem[] = [
    { label: "编辑", icon: <Pencil className="size-3.5" />, onSelect: onEdit },
    { label: "删除", icon: <Trash2 className="size-3.5" />, onSelect: onRemove, tone: "danger" },
  ];

  return (
    <tr className={cx(
      "border-b border-border/60 last:border-0",
      "transition-colors duration-fast ease-smooth hover:bg-panel-hover",
    )}>
      <td className="py-2.5 pl-4 pr-3">
        <div className="flex items-center gap-2">
          <span className="font-medium text-fg">{job.name}</span>
          <Badge tone={job.enabled ? "success" : "neutral"}>{job.enabled ? "启用" : "停用"}</Badge>
        </div>
        <div className="mt-0.5 text-xs text-fg-subtle">{job.account_name ?? "账号已删除"}</div>
      </td>
      <td className="p-3 text-xs">
        <div className="font-mono text-fg">{job.repo}</div>
        <div className="mt-0.5 font-mono text-fg-muted">{targetOf(job)}</div>
      </td>
      <td className="p-3 text-xs whitespace-nowrap">
        <div className="text-fg-muted">{schedule}</div>
        {job.enabled === 1 ? (
          <div className="mt-0.5 tabular-nums text-fg-muted">
            下次 {fmtShort(job.next_run_at)}{" "}
            <span className="text-fg-subtle">{relativeTime(job.next_run_at)}</span>
          </div>
        ) : (
          <div className="mt-0.5 text-fg-subtle">—</div>
        )}
      </td>
      <td className="p-3 text-xs whitespace-nowrap">
        {line && LineIcon ? (
          <span className={`inline-flex items-center gap-1.5 ${LINE_CLS[line.tone]}`}>
            <LineIcon className="size-3.5 shrink-0" aria-hidden />
            <span className="tabular-nums">{line.text}</span>
          </span>
        ) : (
          <span className="text-fg-subtle">—</span>
        )}
      </td>
      <td className="p-3">
        <Switch checked={job.enabled === 1} onChange={() => onToggle()} label={`启用「${job.name}」`} />
      </td>
      <td className="py-2.5 pl-3 pr-4">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" loading={triggering} onClick={onTrigger}
            icon={<Play className="size-3.5" />}>触发</Button>
          <Menu label={`「${job.name}」更多操作`} items={items} />
        </div>
      </td>
    </tr>
  );
}
