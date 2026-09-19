import { Fragment, useEffect, useId, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { get, errText } from "../api";
import PageHeader from "../components/PageHeader";
import { useToast } from "../components/Toast";
import type { Job, Run } from "../types";
import { SOURCE_LABEL } from "../types";
import { Badge, Button, EmptyState, Segmented, Select, Skeleton, cx, focusRing } from "../ui";
import { ChevronDown, ChevronLeft, ChevronRight, Inbox, LoaderCircle, Trash2 } from "../ui/icons";
import { fmtTime } from "../utils/time";
import { useAlive } from "../utils/useAlive";
import { useAutoRefresh } from "../utils/useAutoRefresh";
import RunsCleanupDialog from "./RunsCleanupDialog";

const PAGE_SIZE = 50; // 与服务端 routes/runs.ts 的 PAGE_SIZE 一致

type StatusFilter = "" | "success" | "failed" | "running" | "waiting" | "unknown";

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "", label: "全部" },
  { value: "success", label: "成功" },
  { value: "failed", label: "失败" },
  { value: "running", label: "进行中" },
  { value: "waiting", label: "排队中" },
  { value: "unknown", label: "未知" },
];

/** GitHub conclusion → 中文标签；未收录的原样展示（GitHub 未来加新值不炸） */
const GH_CONCLUSION_LABEL: Record<string, string> = {
  success: "成功",
  failure: "失败",
  cancelled: "已取消",
  startup_failure: "启动失败",
  timed_out: "超时",
  skipped: "跳过",
};

function RunBadge({ run }: { run: Run }) {
  if (run.status === "failed") return <Badge tone="danger">触发失败</Badge>;
  if (run.gh_state == null) return <Badge tone="success">触发成功</Badge>;
  switch (run.gh_state) {
    case "waiting":
      return <Badge tone="neutral">排队中</Badge>;
    case "running":
      return <Badge tone="warn" icon={<LoaderCircle className="size-3 animate-spin" />}>进行中</Badge>;
    case "unknown":
      return <Badge tone="warn">未知</Badge>;
    case "done":
      return run.gh_conclusion === "success"
        ? <Badge tone="success">成功</Badge>
        : <Badge tone="danger">执行失败</Badge>;
  }
}

export default function Runs() {
  const toast = useToast();
  const detailId = useId();
  const [params, setParams] = useSearchParams();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<Run[] | null>(null); // null = 加载中
  const [expanded, setExpanded] = useState<number | null>(null);
  // 清理后必须重拉列表：筛选与页码都在 URL 里，若清理时已经在第 1 页，
  // patch({ page: "" }) 不改变任何 query，下面 effect 的依赖（全是原始值）不变，
  // 列表会停在已被删除的旧数据上。用一个自增标记显式触发重拉。
  const [nonce, setNonce] = useState(0);
  const [retention, setRetention] = useState(90);
  const [cleanupOpen, setCleanupOpen] = useState(false);

  useEffect(() => {
    get<{ days: number }>("/api/runs/retention").then(d => setRetention(d.days)).catch(() => {});
  }, []);

  // URL 是用户可编辑的：?status=whatever 必须退化成「全部」而不是原样发给后端。
  // 服务端也做了同样的白名单（routes/runs.ts STATUS_FILTERS），两端各挡一次。
  // 旧版链接可能带 gh=（两段式筛选时代），这里作为兼容入口一起读取。
  const raw = params.get("status") ?? params.get("gh");
  const status: StatusFilter = STATUS_OPTIONS.some(o => o.value !== "" && o.value === raw) ? (raw as StatusFilter) : "";
  const jobId = Number(params.get("job_id") ?? 0) || 0;
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);

  /** 改筛选条件时同时把 page 清掉，避免停在一个不存在的页码上。 */
  function patch(next: Partial<Record<"status" | "job_id" | "page", string>>) {
    const q = new URLSearchParams(params);
    q.delete("gh");
    if (status) q.set("status", status);
    for (const [k, v] of Object.entries(next)) {
      if (!v) q.delete(k); else q.set(k, v);
    }
    setParams(q, { replace: true });
  }

  /** 当前筛选对应的 runs 查询串（首次拉取与自动刷新共用） */
  const runsQuery = () => new URLSearchParams({
    page: String(page),
    ...(jobId ? { job_id: String(jobId) } : {}),
    ...(status ? { status } : {}),
  });

  useEffect(() => { get<Job[]>("/api/jobs").then(setJobs).catch(() => {}); }, []);

  // alive 标记：连点筛选/翻页时「先发后到」的旧响应不能覆盖新响应，
  // 卸载后也不再 setState。与 Layout 里 /api/stats 的处理保持一致。
  useEffect(() => {
    let alive = true;
    setRows(null);
    get<{ total: number; rows: Run[] }>(`/api/runs?${runsQuery()}`)
      .then(d => { if (!alive) return; setTotal(d.total); setRows(d.rows); })
      .catch(e => { if (!alive) return; setRows([]); toast(errText(e), "err"); });
    return () => { alive = false; };
  }, [jobId, status, page, nonce]);

  // 静默自动刷新：30 秒重拉当前筛选页，保留旧数据不闪骨架屏；
  // 清理弹窗打开时暂停，页面不可见时由 hook 统一暂停。
  const alive = useAlive();
  const queryKey = `${runsQuery()}&nonce=${nonce}`;
  const currentQuery = useRef(queryKey);
  currentQuery.current = queryKey;
  useAutoRefresh(() => {
    get<{ total: number; rows: Run[] }>(`/api/runs?${runsQuery()}`)
      .then(d => { if (alive.current && currentQuery.current === queryKey) { setTotal(d.total); setRows(d.rows); } })
      .catch(() => {});
  }, 30_000, !cleanupOpen);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = (page - 1) * PAGE_SIZE + 1;

  return (
    <div>
      <PageHeader
        title="运行记录"
        description={`共 ${total} 条，自动保留最近 ${retention} 天。`}
        action={
          // 打开清理对话框（自动保留期配置 + 按天数/范围立即清理）。
          // 用 danger：入口主操作是破坏性清理，不该被讲成推荐的下一步。
          <Button variant="danger" onClick={() => setCleanupOpen(true)}
            icon={<Trash2 className="size-4" />}>清理记录</Button>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="max-w-full overflow-x-auto">
          <Segmented
            label="按状态筛选"
            value={status}
            options={STATUS_OPTIONS}
            onChange={v => patch({ status: v, page: "" })}
          />
        </div>
        <label className="flex items-center gap-2">
          <span className="text-xs text-fg-muted">任务</span>
          <Select aria-label="按任务筛选" value={jobId}
            onChange={e => patch({ job_id: e.target.value === "0" ? "" : e.target.value, page: "" })}>
            <option value={0}>全部任务</option>
            {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
          </Select>
        </label>
      </div>

      <p className="mb-4 text-xs text-fg-muted">
        失败包含触发失败和 Workflow 执行失败；未追踪的历史记录按触发结果归类。
      </p>

      <div aria-busy={rows === null} className="overflow-x-auto rounded-xl border border-border bg-panel">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-fg-muted">
              <th className="py-2.5 pr-3 pl-4 font-medium">时间</th>
              <th className="p-3 font-medium">任务</th>
              <th className="p-3 font-medium">来源</th>
              <th className="p-3 font-medium">状态</th>
              <th className="p-3 font-medium">HTTP</th>
              <th className="p-3 font-medium">说明</th>
            </tr>
          </thead>
          <tbody>
            {rows === null && [0, 1, 2, 3, 4].map(i => (
              <tr key={i} className="border-b border-border/60 last:border-0">
                <td className="py-3 pr-3 pl-4"><Skeleton className="h-4 w-36" /></td>
                <td className="p-3"><Skeleton className="h-4 w-40" /></td>
                <td className="p-3"><Skeleton className="h-4 w-8" /></td>
                <td className="p-3"><Skeleton className="h-4 w-8" /></td>
                <td className="p-3"><Skeleton className="h-4 w-8" /></td>
                <td className="p-3"><Skeleton className="h-4 w-14" /></td>
              </tr>
            ))}

            {rows?.map(r => {
              const failed = r.status === "failed";
              // workflow 真失败也是失败：触发成功但 conclusion ≠ success 的行
              // 同样用危险色带，两个失败维度在列表里一眼可分（状态列 vs 徽章列）。
              const ghFailed = r.status === "success" && r.gh_state === "done" && r.gh_conclusion !== "success";
              const bad = failed || ghFailed;
              // 失败行可展开看详情（触发错误 / GitHub run 外链）；成功行没有内容可看，
              // 挂上 onClick 只会得到一个点了没反应的可点区域。
              const canExpand = (failed && !!r.error_message) || (ghFailed && !!r.gh_run_url);
              const isOpen = expanded === r.id;
              return (
                <Fragment key={r.id}>
                  {/* 整行可点只是鼠标便利，所以 <tr> 保持原生 row 语义：给它套
                      role="button" 会顶掉 row 角色，读屏软件的表格导航（按单元格、
                      读表头）就整块失效了。键盘与读屏走下面状态格里那个真正的
                      <button>，它带 aria-expanded 与 aria-controls。 */}
                  <tr
                    onClick={canExpand ? () => setExpanded(isOpen ? null : r.id) : undefined}
                    className={cx(
                      "border-b border-border/60 last:border-0",
                      "transition-colors duration-fast ease-smooth",
                      // 失败行也保留 hover 反馈，只是底色系不同；普通行走中性 hover
                      bad ? "bg-danger-soft hover:bg-danger/10" : "hover:bg-panel-hover",
                      canExpand && "cursor-pointer",
                    )}
                  >
                    {/* 状态色带做在第一个 td 的 border-l 上：border-collapse: collapse
                        下 tr 自身的边框渲染行为不一致。 */}
                    <td className={cx(
                      "border-l-2 py-3 pr-3 pl-4 text-xs whitespace-nowrap tabular-nums",
                      bad ? "border-l-danger" : "border-l-success",
                    )}>{fmtTime(r.triggered_at)}</td>
                    <td className="p-3">{r.job_name ?? `任务#${r.job_id}`}</td>
                    <td className="p-3 text-xs text-fg-muted">{SOURCE_LABEL[r.source] ?? "定时"}</td>
                    <td className="p-3 whitespace-nowrap">
                      {canExpand ? (
                        <button type="button"
                          aria-expanded={isOpen}
                          aria-controls={`${detailId}-${r.id}`}
                          onClick={e => { e.stopPropagation(); setExpanded(isOpen ? null : r.id); }}
                          className={cx(
                            "inline-flex items-center gap-1 rounded font-medium",
                            "underline decoration-dotted underline-offset-2",
                            focusRing,
                          )}>
                          <RunBadge run={r} />
                          <ChevronDown aria-hidden className={cx(
                            "size-3.5 transition-transform duration-fast ease-smooth",
                            isOpen && "rotate-180",
                          )} />
                        </button>
                      ) : <RunBadge run={r} />}
                    </td>
                    <td className="p-3 font-mono text-xs tabular-nums">{r.http_status || "-"}</td>
                    <td className="p-3 text-xs text-fg-muted">
                      {failed ? "请求未成功" : r.gh_state == null ? "历史记录，未追踪执行结果"
                        : r.gh_state === "waiting" ? "等待关联 GitHub 运行"
                        : r.gh_state === "running" ? "等待执行完成"
                        : r.gh_state === "unknown" ? "追踪超时，结果未知"
                        : GH_CONCLUSION_LABEL[r.gh_conclusion ?? ""] ?? r.gh_conclusion ?? "无执行结论"}
                    </td>
                  </tr>
                  {(isOpen && (r.error_message || (ghFailed && r.gh_run_url))) && (
                    <tr className="border-b border-border/60 last:border-0">
                      <td id={`${detailId}-${r.id}`} colSpan={6}
                        className={cx(
                          "border-l-2 px-4 py-3",
                          bad ? "border-l-danger bg-danger-soft" : "bg-panel-hover",
                        )}>
                        {/* 错误文本可能很长且带换行：pre-wrap 保留换行，break-all 兜住
                            长 URL / JSON 不撑破表格。绝不用 dangerouslySetInnerHTML。 */}
                        {r.error_message && (
                          <p className="font-mono text-xs break-all whitespace-pre-wrap text-danger">
                            {r.error_message}
                          </p>
                        )}
                        {ghFailed && r.gh_run_url && (
                          <a href={r.gh_run_url} target="_blank" rel="noreferrer"
                            className={cx(
                              "inline-flex items-center gap-1 text-xs font-medium",
                              "underline decoration-dotted underline-offset-2",
                              focusRing,
                            )}>
                            在 GitHub 查看该次运行<ChevronRight className="size-3" />
                          </a>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>

        {rows?.length === 0 && (
          <EmptyState
            icon={<Inbox className="size-6" />}
            title="暂无记录"
            description={status || jobId
              ? "当前状态或任务下没有记录，可切换为全部状态或全部任务。"
              : "任务跑起来之后这里会出现记录。"}
          />
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-fg-muted tabular-nums">
          {total === 0
            ? "第 0 条"
            : from > total
              // 手写 URL 给了越界页码：这一页没有数据，别渲染「第 4901–12 条」这种句子
              ? `共 ${total} 条`
              : `第 ${from}–${Math.min(page * PAGE_SIZE, total)} 条，共 ${total} 条`}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" disabled={page <= 1}
            onClick={() => patch({ page: String(page - 1) })}
            icon={<ChevronLeft className="size-4" />}>上一页</Button>
          <span className="tabular-nums text-fg-muted">{page} / {totalPages}</span>
          {/* 「下一页」的箭头要在文字右侧，所以写在 children 里而不是走 icon prop */}
          <Button variant="secondary" size="sm" disabled={page >= totalPages}
            onClick={() => patch({ page: String(page + 1) })}>
            下一页<ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <RunsCleanupDialog
        open={cleanupOpen}
        retentionDays={retention}
        onClose={() => setCleanupOpen(false)}
        onRetentionChanged={setRetention}
        onCleaned={() => { patch({ page: "" }); setNonce(n => n + 1); }}
      />
    </div>
  );
}
