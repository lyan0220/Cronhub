import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { get } from "../api";
import PageHeader from "../components/PageHeader";
import type { Job, Run, Stats } from "../types";
import { SOURCE_LABEL } from "../types";
import { Card, EmptyState, Skeleton, SkeletonCard, Button, cx } from "../ui";
import { ArrowRight, Activity, CircleAlert, CircleCheck, CircleX, Clock, HeartPulse, Inbox, LoaderCircle, RefreshCw, Timer, Users } from "../ui/icons";
import { fmtShort, fmtShortTz, relativeTime } from "../utils/time";
import { useAlive } from "../utils/useAlive";
import { useAutoRefresh } from "../utils/useAutoRefresh";
import { describeLocal, describeRule, displayTzOf, parseSchedule } from "./Jobs/schedule";

type StatCard = {
  key: string;
  label: string;
  icon: React.ReactNode;
  /** 主数字；缺省取 stats[key] */
  value?: (s: Stats) => number | null;
  /** 主数字告警色判定（只染数字） */
  danger?: (s: Stats) => boolean;
  /** 异常时整卡红色底色 */
  tint?: (s: Stats) => boolean;
  suffix?: string;
  /** 副行：可选（账号卡无副行） */
  sub?: (s: Stats) => string | null;
  /** 副行告警色判定 */
  subDanger?: (s: Stats) => boolean;
  /** 整卡点击跳转（常规入口：查看全部） */
  to?: (s: Stats) => string | null;
  /** 副行跳转（只看异常项）；null = 副行为纯文本 */
  subTo?: (s: Stats) => string | null;
};

const CARDS: StatCard[] = [
  { key: "accounts", label: "账号", icon: <Users className="size-4" />, to: () => "/accounts" },
  { key: "total_jobs", label: "任务", icon: <Timer className="size-4" />, to: () => "/jobs",
    sub: s => `启用 ${s.enabled_jobs} / ${s.total_jobs}` },
  { key: "total_monitors", label: "监控", icon: <HeartPulse className="size-4" />, to: () => "/monitors",
    sub: s => (s.down_monitors > 0 ? `故障 ${s.down_monitors}` : "全部正常"),
    subDanger: s => s.down_monitors > 0,
    tint: s => s.down_monitors > 0,
    subTo: s => (s.down_monitors > 0 ? "/monitors?status=down" : null) },
  { key: "today_runs", label: "今日运行", icon: <Clock className="size-4" />, to: () => "/runs",
    sub: s => {
      const n = s.failed_24h + s.gh_failed_24h;
      return n > 0 ? `失败 ${n}` : "全部成功";
    },
    subDanger: s => s.failed_24h + s.gh_failed_24h > 0,
    tint: s => s.failed_24h + s.gh_failed_24h > 0,
    subTo: s => (s.failed_24h + s.gh_failed_24h > 0 ? "/runs?status=failed" : null) },
  { key: "success_rate_7d", label: "7 天成功率", icon: <CircleCheck className="size-4" />, suffix: "%",
    sub: s => (s.gh_done_7d > 0 ? `基于 ${s.gh_done_7d} 次执行` : "暂无执行") },
];

/** 侧栏「即将运行」最多展示的条数 */
const UPCOMING_LIMIT = 10;

// 心跳超过 3 个调度周期（cron 触发每 5 分钟一轮）未更新，判定定时触发链路停了
const HEARTBEAT_STALE_MS = 15 * 60_000;

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

  // 自动刷新：统计/最近运行/即将运行每 30 秒重拉，页面不可见时暂停
  useAutoRefresh(load, 30_000);

  // 只看已启用的任务，按下次触发时间升序；filter 已产生新数组，sort 不会动 state
  const upcoming = jobs === null
    ? null
    : jobs.filter(j => j.enabled === 1)
        .sort((a, b) => a.next_run_at - b.next_run_at)
        .slice(0, UPCOMING_LIMIT);

  return (
    <div>
      <PageHeader title="仪表盘" description="定时任务的运行概况与接下来的触发计划。" />

      <div aria-busy={stats === null && !statsError} className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {statsError ? (
          <div className="col-span-full flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">
            <span>统计数据加载失败。</span>
            <Button size="sm" variant="secondary" onClick={load}
              icon={<RefreshCw className="size-3.5" />}>重试</Button>
          </div>
        ) : stats === null
          ? CARDS.map(c => <SkeletonCard key={c.key} />)
          : CARDS.map(c => {
              const v = c.value ? c.value(stats) : (stats[c.key as keyof Stats] as number | null);
              const bad = c.danger?.(stats) ?? false;
              const tinted = c.tint?.(stats) ?? false;
              const sub = c.sub?.(stats) ?? null;
              const subHot = c.subDanger?.(stats) ?? false;
              const subTo = c.subTo?.(stats) ?? null;
              const to = c.to?.(stats) ?? null;
              // 拉伸链接：整卡可点（看全部）；副行是独立链接（只看异常项），
              // relative 置顶不被盖住；hover 反馈经 has(:hover) 传导到卡片边框。
              const inner = (
                <>
                  <div className="flex items-center gap-1.5 text-xs text-fg-muted">
                    {c.icon}<span>{c.label}</span>
                  </div>
                  <p className={cx("mt-2 text-2xl font-semibold tabular-nums", bad && "text-danger")}>
                    {v === null ? "—" : v}{c.suffix ?? ""}
                  </p>
                  {sub !== null && (subTo ? (
                    <Link to={subTo}
                      className={cx("relative z-10 mt-1 inline-flex items-center gap-1 text-xs hover:underline", subHot && "text-danger")}>
                      {sub}<ArrowRight className="size-3" />
                    </Link>
                  ) : (
                    <p className={cx("mt-1 text-xs", subHot ? "text-danger" : "text-fg-subtle")}>{sub}</p>
                  ))}
                </>
              );
              return (
                <div key={c.key} className={cx(
                  "relative rounded-xl border p-4",
                  tinted ? "border-danger/40 bg-danger-soft"
                    : "border-border bg-panel",
                  !tinted && to && "has-[a[data-card]:hover]:border-border-strong has-[a[data-card]:hover]:bg-panel-hover",
                )}>
                  {to && (
                    <Link to={to} data-card aria-label={`${c.label}——查看全部`}
                      className="absolute inset-0 rounded-xl focusRing" />
                  )}
                  {inner}
                </div>
              );
            })}
      </div>

      {/* 调度器心跳：scheduled 入口每轮写一次。超过阈值没活动说明定时触发链路
          停了（部署异常、配额用尽等），统计数字再准也不可信，所以要显性提示。 */}
      {stats !== null && (() => {
        const hb = stats.scheduler_last_run_at;
        const stale = hb === null || Date.now() - hb > HEARTBEAT_STALE_MS;
        return (
          <p className={cx("mb-8 flex items-center gap-1.5 text-xs", stale ? "text-danger" : "text-fg-subtle")}>
            {stale ? <CircleAlert className="size-3.5 shrink-0" /> : <Activity className="size-3.5 shrink-0" />}
            {hb === null
              ? "调度器尚未运行过"
              : `调度器 ${relativeTime(Math.min(hb, Date.now()))}活动${stale ? "，定时触发可能已停止" : ""}`}
          </p>
        );
      })()}

      {/* 宽屏两栏等宽：最近运行 / 即将运行形成「过去 / 未来」对照，
          等宽比主次分栏更对称，数据量不对等时也不会一头重一头轻；
          窄屏退化为上下两段（先过去后未来）。 */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="@container min-w-0">
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
                // 图标反映「当前已知的最坏结果」：触发失败最直接；触发成功后再看
                // workflow 真实结论（追踪未覆盖的旧数据按触发成功展示）。
                const ghState = failed ? null : r.gh_state;
                const ghDone = ghState === "done";
                const ghFailed = ghDone && r.gh_conclusion !== "success";
                const bad = failed || ghFailed;
                const icon = failed
                  ? <CircleX className="size-4 shrink-0 text-danger" />
                  : ghFailed
                    ? <CircleX className="size-4 shrink-0 text-danger" />
                    : ghState === "running"
                      ? <LoaderCircle className="size-4 shrink-0 animate-spin text-warn" />
                      : ghState === "waiting"
                        ? <Clock className="size-4 shrink-0 text-fg-subtle" />
                        : ghState === "unknown"
                          ? <CircleAlert className="size-4 shrink-0 text-warn" />
                          : <CircleCheck className={cx("size-4 shrink-0", ghDone ? "text-success" : "text-fg-subtle")} />;
                const iconTitle = failed
                  ? "触发失败"
                  : ghFailed
                    ? `workflow 执行失败（${r.gh_conclusion}）`
                    : ghState === "running" ? "workflow 执行中"
                    : ghState === "waiting" ? "等待 workflow 开始"
                    : ghState === "unknown" ? "workflow 结果未知"
                    : ghDone ? "workflow 执行成功" : "触发成功";
                return (
                  // 四栏表格样式：名称 / 来源 / 绝对时间 / 相对时间，各占一栏跨行对齐。
                  // 面板变窄时来源列连续收缩（truncate 持续省略），收缩到基本只剩
                  // 省略号时（@max-sm，384px）才整列移除，几乎无感；名称保底 6rem。
                  <div key={r.id} className="grid grid-cols-[minmax(6rem,1fr)_minmax(0,3rem)_5rem_4rem] @max-sm:grid-cols-[minmax(0,1fr)_5rem_4rem] items-center gap-x-3 px-4 py-2.5 text-sm transition-colors duration-fast ease-smooth hover:bg-panel-hover">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span title={iconTitle} className="shrink-0">{icon}</span>
                      <span className="min-w-0 truncate font-medium">{r.job_name ?? `任务#${r.job_id}`}</span>
                    </div>
                    <span className="min-w-0 truncate whitespace-nowrap text-xs text-fg-subtle @max-sm:hidden">{SOURCE_LABEL[r.source] ?? "定时"}</span>
                    <span className="whitespace-nowrap text-xs tabular-nums text-fg-muted">{fmtShort(r.triggered_at)}</span>
                    <span className={cx("whitespace-nowrap text-xs tabular-nums", bad ? "font-medium text-danger" : "text-fg-subtle")}>{relativeTime(r.triggered_at)}</span>
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

        <section className="@container min-w-0">
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
              {upcoming.map(j => {
                const s = parseSchedule(j.schedule_json);
                const dTz = displayTzOf(s, j.timezone); // 时间列与调度描述同时区显示
                return (
                <div key={j.id} className="grid grid-cols-[minmax(6rem,1fr)_minmax(0,9rem)_5rem_4rem] @max-md:grid-cols-[minmax(0,1fr)_5rem_4rem] items-center gap-x-3 px-4 py-2.5 text-sm transition-colors duration-fast ease-smooth hover:bg-panel-hover">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Clock className="size-4 shrink-0 text-fg-subtle" />
                    <span className="min-w-0 truncate font-medium" title={j.name}>{j.name}</span>
                  </div>
                  {/* 调度列只显示规则本身；时区标注放 hover（时间列已按时区渲染）。
                      容器 < 448px 时优先整列隐藏调度，把宽度让给任务名。 */}
                  <span className="min-w-0 truncate whitespace-nowrap text-xs text-fg-subtle @max-md:hidden" title={describeLocal(s, j.timezone)}>{describeRule(s)}</span>
                  <span className="whitespace-nowrap text-xs tabular-nums text-fg-muted">{fmtShortTz(j.next_run_at, dTz)}</span>
                  <span className="whitespace-nowrap text-xs tabular-nums text-fg-subtle">{untilText(j.next_run_at)}</span>
                </div>
                );
              })}
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
