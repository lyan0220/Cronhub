import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { get } from "../api";
import PageHeader from "../components/PageHeader";
import type { Run, Stats } from "../types";
import { Card, EmptyState, Skeleton, SkeletonCard, Button, cx } from "../ui";
import { ArrowRight, CircleAlert, CircleCheck, CircleX, Clock, Inbox, Play, RefreshCw, Timer, Users } from "../ui/icons";
import { fmtShort, relativeTime } from "../utils/time";

type StatCard = {
  key: keyof Stats;
  label: string;
  icon: React.ReactNode;
  alarm?: boolean;
};

const CARDS: StatCard[] = [
  { key: "accounts", label: "账号", icon: <Users className="size-4" /> },
  { key: "total_jobs", label: "任务总数", icon: <Timer className="size-4" /> },
  { key: "enabled_jobs", label: "已启用", icon: <Play className="size-4" /> },
  { key: "today_runs", label: "今日运行", icon: <Clock className="size-4" /> },
  { key: "failed_24h", label: "近 24h 失败", icon: <CircleAlert className="size-4" />, alarm: true },
];

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [statsError, setStatsError] = useState(false);
  const [runsError, setRunsError] = useState(false);

  // 加载失败不能落回 null——null 被渲染成骨架屏，网络错误会表现为"永远在加载"。
  // 错误是独立状态，骨架屏只属于"还没拿到结果"。
  function load() {
    setStatsError(false);
    setRunsError(false);
    get<Stats>("/api/stats").then(setStats).catch(() => setStatsError(true));
    get<{ rows: Run[] }>("/api/runs?page=1")
      .then(d => setRuns(d.rows.slice(0, 10)))
      .catch(() => setRunsError(true));
  }

  useEffect(load, []);

  return (
    <div>
      <PageHeader title="仪表盘" description="定时任务的运行概况。" />

      <div aria-busy={stats === null && !statsError} className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {statsError ? (
          <div className="col-span-full flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">
            <span>统计数据加载失败。</span>
            <Button size="sm" variant="secondary" onClick={load}
              icon={<RefreshCw className="size-3.5" />}>重试</Button>
          </div>
        ) : stats === null
          ? CARDS.map(c => <SkeletonCard key={c.key} />)
          : CARDS.map(c => {
              const v = stats[c.key];
              const hot = !!c.alarm && v > 0;
              return (
                <div key={c.key} className={cx(
                  "rounded-xl border p-4 transition-colors duration-fast ease-smooth",
                  hot ? "border-danger/40 bg-danger-soft" : "border-border bg-panel",
                )}>
                  <div className={cx("flex items-center gap-1.5 text-xs", hot ? "text-danger" : "text-fg-muted")}>
                    {c.icon}<span>{c.label}</span>
                  </div>
                  <p className={cx("mt-2 text-2xl font-semibold tabular-nums", hot && "text-danger")}>{v}</p>
                  {hot && (
                    <Link to="/runs?status=failed"
                      className="mt-1 inline-flex items-center gap-0.5 text-xs text-danger underline-offset-2 hover:underline">
                      查看失败记录<ArrowRight className="size-3" />
                    </Link>
                  )}
                </div>
              );
            })}
      </div>

      <h2 className="mb-3 text-sm font-medium">最近运行</h2>

      {runsError ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-fg-muted">
          <span>运行记录加载失败。</span>
          <Button size="sm" variant="secondary" onClick={load}
            icon={<RefreshCw className="size-3.5" />}>重试</Button>
        </Card>
      ) : runs === null ? (
        <Card>
          <div aria-busy="true" className="divide-y divide-border/60">
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="size-4 rounded-full" />
                <Skeleton className="h-4 w-40" />
                <Skeleton className="ml-auto h-4 w-32" />
              </div>
            ))}
          </div>
        </Card>
      ) : runs.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Inbox className="size-6" />}
            title="暂无运行记录"
            description="任务第一次触发之后，这里会显示最近 10 条。"
          />
        </Card>
      ) : (
        <Card className="divide-y divide-border/60">
          {runs.map(r => {
            const failed = r.status === "failed";
            return (
              <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm transition-colors duration-fast ease-smooth hover:bg-panel-hover">
                {failed
                  ? <CircleX className="size-4 shrink-0 text-danger" />
                  : <CircleCheck className="size-4 shrink-0 text-success" />}
                <span className="min-w-0 truncate font-medium">{r.job_name ?? `任务#${r.job_id}`}</span>
                <span className="text-xs text-fg-subtle">{r.source === "manual" ? "手动" : "定时"}</span>
                {failed && r.http_status ? <span className="font-mono text-xs text-danger">HTTP {r.http_status}</span> : null}
                <span className="ml-auto text-xs whitespace-nowrap text-fg-muted tabular-nums">
                  {fmtShort(r.triggered_at)} · {relativeTime(r.triggered_at)}
                </span>
              </div>
            );
          })}
          <Link to="/runs"
            className="flex items-center justify-center gap-1 px-4 py-2.5 text-xs font-medium transition-colors duration-fast ease-smooth hover:bg-panel-hover">
            查看全部运行记录<ArrowRight className="size-3" />
          </Link>
        </Card>
      )}
    </div>
  );
}

