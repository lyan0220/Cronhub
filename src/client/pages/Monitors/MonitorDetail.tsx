import { useEffect, useState } from "react";
import { del, errText, get } from "../../api";
import { useToast } from "../../components/Toast";
import type { Heartbeat, Monitor, MonitorStats } from "../../types";
import { Badge, Button, Drawer, Skeleton, useConfirm } from "../../ui";
import { RefreshCw, Trash2 } from "../../ui/icons";
import { fmtTime, relativeTime } from "../../utils/time";
import HeartbeatBar from "./HeartbeatBar";

type Props = {
  monitor: Monitor;
  onClose: () => void;
};

const PAGE_SIZE = 50;

function Pct({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-fg-subtle">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value === null ? "—" : `${value}%`}</p>
    </div>
  );
}

export default function MonitorDetail({ monitor, onClose }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const [stats, setStats] = useState<MonitorStats | null>(null);
  const [beats, setBeats] = useState<Heartbeat[] | null>(null);
  const [rows, setRows] = useState<Heartbeat[] | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  async function load() {
    const [s, recent, page1] = await Promise.all([
      get<MonitorStats>(`/api/monitors/${monitor.id}/stats`),
      get<Heartbeat[]>(`/api/monitors/${monitor.id}/heartbeats?limit=${PAGE_SIZE}`),
      get<Heartbeat[]>(`/api/monitors/${monitor.id}/heartbeats?limit=${PAGE_SIZE + 1}`),
    ]);
    setStats(s);
    // 接口按 id 倒序返回（新→旧）；条带需要旧→新（左旧右新，与列表卡片一致）
    setBeats(recent.slice(0, PAGE_SIZE).reverse());
    setRows(page1.slice(0, PAGE_SIZE));
    setHasMore(page1.length > PAGE_SIZE);
  }

  useEffect(() => {
    setStats(null);
    setBeats(null);
    setRows(null);
    setHasMore(false);
    load().catch(e => toast(errText(e), "err"));
  }, [monitor.id]);

  async function loadMore() {
    if (!rows || rows.length === 0) return;
    setLoadingMore(true);
    try {
      const before = rows[rows.length - 1].id;
      const next = await get<Heartbeat[]>(`/api/monitors/${monitor.id}/heartbeats?limit=${PAGE_SIZE}&before=${before}`);
      // 心跳只增不删（除保留期清理尾部），追加不会与已有页重叠出空洞
      setRows([...rows, ...next]);
      setHasMore(next.length >= PAGE_SIZE);
    } catch (e) {
      toast(errText(e), "err");
    } finally {
      setLoadingMore(false);
    }
  }

  async function clearAll() {
    const ok = await confirm({
      title: `清空「${monitor.name}」的全部心跳？`,
      description: "所有探测记录会被删除，在线率统计将重新从零积累，监控本身不受影响。",
      confirmText: "清空",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await del(`/api/monitors/${monitor.id}/heartbeats`);
      toast("心跳记录已清空");
      setRows([]);
      setBeats([]);
      setHasMore(false);
      await load().catch(() => {}); // 重拉在线率统计（窗口内已无数据 → 显示 —）
    } catch (e) {
      toast(errText(e), "err");
    }
  }

  return (
    <Drawer open onClose={onClose} title={`监控详情：${monitor.name}`}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          <Badge tone={monitor.status === "up" ? "success" : monitor.status === "down" ? "danger" : "neutral"}>
            {monitor.status === "up" ? "正常" : monitor.status === "down" ? "故障" : "待探测"}
          </Badge>
          <span className="min-w-0 truncate font-mono" title={monitor.url}>{monitor.url}</span>
        </div>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold tracking-wide text-fg-subtle uppercase">在线率与延迟</h3>
            <button type="button" onClick={() => { setStats(null); void load().catch(() => {}); }}
              className="inline-flex items-center gap-1 text-xs text-fg-muted underline-offset-2 hover:text-fg hover:underline">
              <RefreshCw className="size-3" />刷新
            </button>
          </div>
          {stats === null ? (
            <Skeleton className="h-16 w-full rounded-xl" />
          ) : (
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-border px-4 py-3 sm:grid-cols-5">
              <Pct label="24 小时" value={stats.uptime_24h} />
              <Pct label="7 天" value={stats.uptime_7d} />
              <Pct label="30 天" value={stats.uptime_30d} />
              <div className="min-w-0">
                <p className="text-xs text-fg-subtle">平均延迟</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums">{stats.avg_latency_24h ?? "—"}<span className="text-xs font-normal text-fg-subtle">ms</span></p>
              </div>
              <div className="min-w-0">
                <p className="text-xs text-fg-subtle">峰值延迟</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums">{stats.max_latency_24h ?? "—"}<span className="text-xs font-normal text-fg-subtle">ms</span></p>
              </div>
            </div>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-fg-subtle uppercase">最近心跳</h3>
          {beats === null ? (
            <Skeleton className="h-8 w-full" />
          ) : beats.length === 0 ? (
            <p className="text-sm text-fg-subtle">还没有探测记录，等调度器跑一轮或点列表卡片的「立即检测」。</p>
          ) : (
            <HeartbeatBar beats={beats} slots={50} size="lg" />
          )}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold tracking-wide text-fg-subtle uppercase">探测记录</h3>
            {rows !== null && rows.length > 0 && (
              <button type="button" onClick={() => void clearAll()}
                className="inline-flex items-center gap-1 text-xs text-fg-muted underline-offset-2 hover:text-danger hover:underline">
                <Trash2 className="size-3" />清空记录
              </button>
            )}
          </div>
          {rows === null ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-10 w-full rounded-lg" />
              <Skeleton className="h-10 w-full rounded-lg" />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-fg-subtle">暂无记录。</p>
          ) : (
            <div className="divide-y divide-border/60 rounded-lg border border-border">
              {rows.map(b => (
                <div key={b.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className={`size-2 shrink-0 rounded-full ${b.status === "up" ? "bg-success" : "bg-danger"}`}
                    aria-hidden />
                  <span className="w-36 shrink-0 text-xs tabular-nums text-fg-muted">{fmtTime(b.created_at)}</span>
                  <span className="w-14 shrink-0 text-xs tabular-nums text-fg-muted">{relativeTime(b.created_at)}</span>
                  <span className="min-w-0 flex-1 truncate text-xs">
                    {b.status === "up"
                      ? <span className="text-fg-muted">HTTP {b.http_status ?? "-"} · {b.latency_ms ?? "-"}ms</span>
                      : <span className="text-danger">{b.error_message ?? (b.http_status != null ? `HTTP ${b.http_status}` : "失败")}</span>}
                  </span>
                  {b.status === "up" && <span className="shrink-0 tabular-nums text-xs text-fg-muted">{b.latency_ms ?? "-"}ms</span>}
                </div>
              ))}
              {hasMore && (
                <div className="p-2 text-center">
                  <Button size="sm" variant="secondary" loading={loadingMore} onClick={() => void loadMore()}>
                    加载更多
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </Drawer>
  );
}
