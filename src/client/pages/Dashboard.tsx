import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { get } from "../api";
import PageHeader from "../components/PageHeader";
import type { Job, Run, Stats } from "../types";
import { Card, EmptyState, Skeleton, SkeletonCard, Button, cx } from "../ui";
import { ArrowRight, CircleAlert, CircleCheck, CircleX, Clock, Inbox, Play, RefreshCw, Timer, Users } from "../ui/icons";
import { fmtShort, relativeTime } from "../utils/time";
import { useAlive } from "../utils/useAlive";
import { describeLocal, parseSchedule } from "./Jobs/schedule";

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

/** 侧栏「即将运行」最多展示的条数 */
const UPCOMING_LIMIT = 10;

// next_run_at 已过但尚未被调度器认领（通常不超过一个调度周期）时显示「即将」，
// 否则相对时间会算出「3 分钟前」这种过去式，读起来像已经跑完了。
function untilText(ms: number): string {
  return ms > Date.now() ? relativeTime(ms) : "即将";
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [statsError, setStatsError] = useState(false);
  const [runsError, setRunsError] = useState(false);
  const [jobsError, setJobsError] = useState(false);
  const alive = useAlive();

  // 加载失败不能落回 null——null 被渲染成骨架屏，网络错误会表现为"永远在加载"。
  // 错误是独立状态，骨架屏只属于"还没拿到结果"。
  function load() {
    setStatsError(false);
    setRunsError(false);
    setJobsError(false);
    get<Stats>("/api/stats")
      .then(s => { if (alive.current) setStats(s); })
      .catch(() => { if (alive.current) setStatsError(true); });
    get<{ rows: Run[] }>("/api/runs?page=1")
      .then(d => { if (alive.current) setRuns(d.rows.slice(0, 10)); })
      .catch(() => { if (alive.current) setRunsError(true); });
    get<Job[]>("/api/jobs")
      .then(d => { if (alive.current) setJobs(d); })
      .catch(() => { if (alive.current) setJobsError(true); });
  }

  useEffect(load, []);

  // 只看已启用的任务，按下次触发时间升序；filter 已产生新数组，sort 不会动 state
  const upcoming = jobs === null
    ? null
    : jobs.filter(j => j.enabled === 1)
        .sort((a, b) => a.next_run_at - b.next_run_at)
        .slice(0, UPCOMING_LIMIT);

  return (
    <div>
      <PageHeader title="仪表盘" description="定时任务的运行概况与接下来的触发计划。" />

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

      {/* 宽屏两栏等宽：最近运行 / 即将运行形成「过去 / 未来」对照，
          等宽比主次分栏更对称，数据量不对等时也不会一头重一头轻；
          窄屏退化为上下两段（先过去后未来）。 */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="min-w-0">
          <h2 className="mb-3 text-sm font-medium">最近运行</h2>

          {runsError ? (
            <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-fg-muted">
              <span>运行记录加载失败。</span>
              <Button size="sm" variant="secondary" onClick={load}
                icon={<RefreshCw className="size-3.5" />}>重试</Button>
            </Card>
          ) : runs === null ? (
            <Card>
              <ListSkeleton rows={5} />
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
                  // 四栏表格样式：名称 / 来源 / 绝对时间 / 相对时间，各占一栏跨行对齐
                  <div key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto_5rem_4rem] items-center gap-x-3 px-4 py-2.5 text-sm transition-colors duration-fast ease-smooth hover:bg-panel-hover">
                    <div className="flex min-w-0 items-center gap-1.5">
                      {failed
                        ? <CircleX className="size-4 shrink-0 text-danger" />
                        : <CircleCheck className="size-4 shrink-0 text-success" />}
                      <span className="min-w-0 truncate font-medium">{r.job_name ?? `任务#${r.job_id}`}</span>
                    </div>
                    <span className="whitespace-nowrap text-xs text-fg-subtle">{r.source === "manual" ? "手动" : "定时"}</span>
                    <span className="whitespace-nowrap text-xs tabular-nums text-fg-muted">{fmtShort(r.triggered_at)}</span>
                    <span className="whitespace-nowrap text-xs tabular-nums text-fg-subtle">{relativeTime(r.triggered_at)}</span>
                  </div>
                );
              })}
              <Link to="/runs"
                className="flex items-center justify-center gap-1 px-4 py-2.5 text-xs font-medium transition-colors duration-fast ease-smooth hover:bg-panel-hover">
                查看全部运行记录<ArrowRight className="size-3" />
              </Link>
            </Card>
          )}
        </section>

        <section className="min-w-0">
          <h2 className="mb-3 text-sm font-medium">即将运行</h2>

          {jobsError ? (
            <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-fg-muted">
              <span>任务数据加载失败。</span>
              <Button size="sm" variant="secondary" onClick={load}
                icon={<RefreshCw className="size-3.5" />}>重试</Button>
            </Card>
          ) : upcoming === null ? (
            <Card>
              <ListSkeleton rows={6} />
            </Card>
          ) : upcoming.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Inbox className="size-6" />}
                title="暂无即将运行的任务"
                description={jobs?.length === 0
                  ? "还没有任务，创建后这里会显示每次触发的计划时间。"
                  : "所有任务都已停用，启用后这里会显示下次触发时间。"}
              />
            </Card>
          ) : (
            <Card className="divide-y divide-border/60">
              {upcoming.map(j => (
                // 四栏表格样式：名称 / 调度规则 / 绝对时间 / 相对时间。调度栏固定宽度，
                // 各行左边缘对齐（auto 会随内容缩放，短文案会贴到时间列形成右对齐感）
                <div key={j.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,11rem)_5rem_4rem] items-center gap-x-3 px-4 py-2.5 text-sm transition-colors duration-fast ease-smooth hover:bg-panel-hover">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Clock className="size-4 shrink-0 text-fg-subtle" />
                    <span className="min-w-0 truncate font-medium">{j.name}</span>
                  </div>
                  <span className="min-w-0 truncate text-xs text-fg-subtle">{describeLocal(parseSchedule(j.schedule_json))}</span>
                  <span className="whitespace-nowrap text-xs tabular-nums text-fg-muted">{fmtShort(j.next_run_at)}</span>
                  <span className="whitespace-nowrap text-xs tabular-nums text-fg-subtle">{untilText(j.next_run_at)}</span>
                </div>
              ))}
              <Link to="/jobs"
                className="flex items-center justify-center gap-1 px-4 py-2.5 text-xs font-medium transition-colors duration-fast ease-smooth hover:bg-panel-hover">
                管理全部任务<ArrowRight className="size-3" />
              </Link>
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}

/** 列表类面板的加载骨架，最近运行 / 即将运行共用 */
function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-busy="true" className="divide-y divide-border/60">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="size-4 rounded-full" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="ml-auto h-4 w-32" />
        </div>
      ))}
    </div>
  );
}
