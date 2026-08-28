import { Fragment, useEffect, useState } from "react";
import { fmtTime, get, post } from "../api";
import { useToast } from "../components/Toast";
import type { Job, Run } from "../types";

const PAGE_SIZE = 50;

export default function Runs() {
  const toast = useToast();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobId, setJobId] = useState(0);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<Run[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => { get<Job[]>("/api/jobs").then(setJobs); }, []);

  useEffect(() => {
    const q = new URLSearchParams({ page: String(page), ...(jobId ? { job_id: String(jobId) } : {}), ...(status ? { status } : {}) });
    get<{ total: number; rows: Run[] }>(`/api/runs?${q}`).then(d => {
      setTotal(d.total);
      setRows(d.rows);
    });
  }, [jobId, status, page]);

  async function cleanup() {
    if (!confirm("清理 90 天前的运行记录？")) return;
    const d = await post<{ deleted: number }>("/api/runs/cleanup", {});
    toast(`已清理 ${d.deleted} 条`);
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">运行记录 <span className="text-sm font-normal text-neutral-500">（共 {total} 条）</span></h1>
        <button onClick={cleanup} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs dark:border-neutral-700">清理 90 天前记录</button>
      </div>

      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="text-neutral-500">按任务筛选：</span>
        <select value={jobId} onChange={e => { setJobId(Number(e.target.value)); setPage(1); }}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 dark:border-neutral-700 dark:bg-neutral-800">
          <option value={0}>全部</option>
          {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
        </select>
        <span className="text-neutral-500">按状态筛选：</span>
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 dark:border-neutral-700 dark:bg-neutral-800">
          <option value="">全部</option>
          <option value="success">成功</option>
          <option value="failed">失败</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500 dark:border-neutral-800">
            <tr><th className="p-3">时间</th><th className="p-3">任务</th><th className="p-3">来源</th><th className="p-3">状态</th><th className="p-3">HTTP</th></tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <Fragment key={r.id}>
                <tr onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                  className={`cursor-pointer border-b border-neutral-100 last:border-0 dark:border-neutral-800/50 ${r.status === "failed" ? "bg-red-50/50 dark:bg-red-950/20" : ""}`}>
                  <td className="p-3 text-xs">{fmtTime(r.triggered_at)}</td>
                  <td className="p-3">{r.job_name ?? `任务#${r.job_id}`}</td>
                  <td className="p-3 text-xs">{r.source === "manual" ? "手动" : "定时"}</td>
                  <td className={`p-3 text-xs ${r.status === "failed" ? "font-medium text-red-600" : "text-emerald-600"}`}>
                    {r.status === "failed" ? "失败" : "成功"}
                  </td>
                  <td className="p-3 font-mono text-xs">{r.http_status || "-"}</td>
                </tr>
                {expanded === r.id && r.error_message && (
                  <tr className="border-b border-neutral-100 dark:border-neutral-800/50">
                    <td colSpan={5} className="p-3 font-mono text-xs text-red-600">{r.error_message}</td>
                  </tr>
                )}
              </Fragment>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-neutral-500">暂无记录</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center gap-3 text-sm">
        <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="rounded-lg border border-neutral-300 px-3 py-1.5 disabled:opacity-40 dark:border-neutral-700">上一页</button>
        <span>{page} / {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="rounded-lg border border-neutral-300 px-3 py-1.5 disabled:opacity-40 dark:border-neutral-700">下一页</button>
      </div>
    </div>
  );
}
