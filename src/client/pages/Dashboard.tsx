import { useEffect, useState } from "react";
import { fmtTime, get } from "../api";
import type { Run, Stats } from "../types";

function Card({ label, value, danger }: { label: string; value: number | string; danger?: boolean }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${danger && Number(value) > 0 ? "text-red-600" : ""}`}>{value}</div>
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<Run[]>([]);

  useEffect(() => {
    get<Stats>("/api/stats").then(setStats);
    get<{ rows: Run[] }>("/api/runs?page=1").then(d => setRecent(d.rows.slice(0, 20)));
  }, []);

  return (
    <div>
      <h1 className="mb-4 text-xl font-bold">仪表盘</h1>
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
        <Card label="账号数" value={stats?.accounts ?? "-"} />
        <Card label="任务数" value={stats?.total_jobs ?? "-"} />
        <Card label="启用中" value={stats?.enabled_jobs ?? "-"} />
        <Card label="今日触发" value={stats?.today_runs ?? "-"} />
        <Card label="近 24h 失败" value={stats?.failed_24h ?? "-"} danger />
      </div>

      <h2 className="mb-2 font-medium">最近运行</h2>
      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500 dark:border-neutral-800">
            <tr><th className="p-3">时间</th><th className="p-3">任务</th><th className="p-3">来源</th><th className="p-3">状态</th></tr>
          </thead>
          <tbody>
            {recent.map(r => (
              <tr key={r.id} className={`border-b border-neutral-100 last:border-0 dark:border-neutral-800/50 ${r.status === "failed" ? "text-red-600" : ""}`}>
                <td className="p-3 text-xs">{fmtTime(r.triggered_at)}</td>
                <td className="p-3">{r.job_name ?? `任务#${r.job_id}`}</td>
                <td className="p-3 text-xs">{r.source === "manual" ? "手动" : "定时"}</td>
                <td className="p-3 text-xs">{r.status === "failed" ? "失败" : "成功"}</td>
              </tr>
            ))}
            {recent.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-neutral-500">暂无记录</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
