import { Fragment, useEffect, useId, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { get, post } from "../api";
import PageHeader from "../components/PageHeader";
import { useToast } from "../components/Toast";
import type { Job, Run } from "../types";
import { Button, EmptyState, Segmented, Select, Skeleton, cx, useConfirm } from "../ui";
import { ChevronDown, ChevronLeft, ChevronRight, Inbox, Trash2 } from "../ui/icons";
import { fmtTime } from "../utils/time";

const PAGE_SIZE = 50; // 与服务端 routes/runs.ts 的 PAGE_SIZE 一致

type StatusFilter = "" | "success" | "failed";

export default function Runs() {
  const toast = useToast();
  const confirm = useConfirm();
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

  // URL 是用户可编辑的：?status=whatever 必须退化成「全部」而不是原样发给后端。
  // 服务端也做了同样的白名单（routes/runs.ts:11），两端各挡一次。
  const raw = params.get("status");
  const status: StatusFilter = raw === "success" || raw === "failed" ? raw : "";
  const jobId = Number(params.get("job_id") ?? 0) || 0;
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);

  /** 改筛选条件时同时把 page 清掉，避免停在一个不存在的页码上。 */
  function patch(next: Partial<Record<"status" | "job_id" | "page", string>>) {
    const q = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (!v) q.delete(k); else q.set(k, v);
    }
    setParams(q, { replace: true });
  }

  useEffect(() => { get<Job[]>("/api/jobs").then(setJobs).catch(() => {}); }, []);

  // alive 标记：连点筛选/翻页时「先发后到」的旧响应不能覆盖新响应，
  // 卸载后也不再 setState。与 Layout 里 /api/stats 的处理保持一致。
  useEffect(() => {
    let alive = true;
    setRows(null);
    const q = new URLSearchParams({
      page: String(page),
      ...(jobId ? { job_id: String(jobId) } : {}),
      ...(status ? { status } : {}),
    });
    get<{ total: number; rows: Run[] }>(`/api/runs?${q}`)
      .then(d => { if (!alive) return; setTotal(d.total); setRows(d.rows); })
      .catch(e => { if (!alive) return; setRows([]); toast((e as Error).message, "err"); });
    return () => { alive = false; };
  }, [jobId, status, page, nonce]);

  async function cleanup() {
    const ok = await confirm({
      title: "清理 90 天前的运行记录？",
      description: "被清理的记录无法恢复。任务本身和调度设置不受影响。",
      confirmText: "清理",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const d = await post<{ deleted: number }>("/api/runs/cleanup", {});
      toast(`已清理 ${d.deleted} 条`);
      patch({ page: "" });
      setNonce(n => n + 1);
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = (page - 1) * PAGE_SIZE + 1;

  return (
    <div>
      <PageHeader
        title="运行记录"
        description={`共 ${total} 条，保留最近 90 天。`}
        action={
          // 本页唯一的头部动作是破坏性的，所以用 danger 而非 primary：
          // 近黑的 primary 会把「清理」讲成本页推荐的下一步。
          <Button variant="danger" onClick={() => void cleanup()}
            icon={<Trash2 className="size-4" />}>清理 90 天前记录</Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          label="按状态筛选"
          value={status}
          options={[
            { value: "", label: "全部" },
            { value: "success", label: "成功" },
            { value: "failed", label: "失败" },
          ]}
          onChange={v => patch({ status: v, page: "" })}
        />
        <div className="w-56">
          <Select aria-label="按任务筛选" value={jobId}
            onChange={e => patch({ job_id: e.target.value, page: "" })}>
            <option value={0}>全部任务</option>
            {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
          </Select>
        </div>
      </div>

      <div aria-busy={rows === null} className="overflow-x-auto rounded-xl border border-border bg-panel">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-fg-muted">
              <th className="py-2.5 pr-3 pl-4 font-medium">时间</th>
              <th className="p-3 font-medium">任务</th>
              <th className="p-3 font-medium">来源</th>
              <th className="p-3 font-medium">状态</th>
              <th className="p-3 font-medium">HTTP</th>
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
              </tr>
            ))}

            {rows?.map(r => {
              const failed = r.status === "failed";
              // 只有「失败且有错误详情」的行可展开：成功行没有内容可看，
              // 挂上 onClick 只会得到一个点了没反应的可点区域。
              const canExpand = failed && !!r.error_message;
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
                      failed ? "bg-danger-soft" : "hover:bg-panel-hover",
                      canExpand && "cursor-pointer",
                    )}
                  >
                    {/* 状态色带做在第一个 td 的 border-l 上：border-collapse: collapse
                        下 tr 自身的边框渲染行为不一致。 */}
                    <td className={cx(
                      "border-l-2 py-3 pr-3 pl-4 text-xs whitespace-nowrap tabular-nums",
                      failed ? "border-l-danger" : "border-l-success",
                    )}>{fmtTime(r.triggered_at)}</td>
                    <td className="p-3">{r.job_name ?? `任务#${r.job_id}`}</td>
                    <td className="p-3 text-xs text-fg-muted">{r.source === "manual" ? "手动" : "定时"}</td>
                    <td className={cx("p-3 text-xs font-medium", failed ? "text-danger" : "text-success")}>
                      {canExpand ? (
                        <button type="button"
                          aria-expanded={isOpen}
                          aria-controls={`${detailId}-${r.id}`}
                          onClick={e => { e.stopPropagation(); setExpanded(isOpen ? null : r.id); }}
                          className={cx(
                            "inline-flex items-center gap-1 rounded font-medium",
                            "underline decoration-dotted underline-offset-2",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                          )}>
                          失败
                          <ChevronDown aria-hidden className={cx(
                            "size-3.5 transition-transform duration-fast ease-smooth",
                            isOpen && "rotate-180",
                          )} />
                        </button>
                      ) : failed ? "失败" : "成功"}
                    </td>
                    <td className="p-3 font-mono text-xs tabular-nums">{r.http_status || "-"}</td>
                  </tr>
                  {isOpen && r.error_message && (
                    <tr className="border-b border-border/60 last:border-0">
                      <td id={`${detailId}-${r.id}`} colSpan={5}
                        className="border-l-2 border-l-danger bg-danger-soft px-4 py-3">
                        {/* 错误文本可能很长且带换行：pre-wrap 保留换行，break-all 兜住
                            长 URL / JSON 不撑破表格。绝不用 dangerouslySetInnerHTML。 */}
                        <p className="font-mono text-xs break-all whitespace-pre-wrap text-danger">
                          {r.error_message}
                        </p>
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
            description={status || jobId ? "当前筛选条件下没有记录，换个条件试试。" : "任务跑起来之后这里会出现记录。"}
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
    </div>
  );
}
