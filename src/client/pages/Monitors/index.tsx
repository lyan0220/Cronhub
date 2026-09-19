import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { del, errText, get, post, put } from "../../api";
import PageHeader from "../../components/PageHeader";
import { useToast } from "../../components/Toast";
import type { Channel, Heartbeat, Job, Monitor, ProbeOutcome } from "../../types";
import { Button, EmptyState, Segmented, Skeleton, SkeletonCard, useConfirm } from "../../ui";
import { Inbox, Plus, Trash2 } from "../../ui/icons";
import { cx } from "../../ui/styles";
import { useAlive } from "../../utils/useAlive";
import { useAutoRefresh } from "../../utils/useAutoRefresh";
import MonitorCard from "./MonitorCard";
import MonitorDetail from "./MonitorDetail";
import MonitorForm, { EMPTY_FORM, type MonitorFormData } from "./MonitorForm";
import { LOCAL_TZ } from "../Jobs/schedule";
import MonitorRow from "./MonitorRow";
import MonitorsCleanupDialog from "./MonitorsCleanupDialog";

type Filter = "" | "up" | "down" | "paused";
type ViewMode = "card" | "list";

const FILTER_OPTIONS: Array<{ value: Filter; label: string }> = [
  { value: "", label: "全部" },
  { value: "up", label: "正常" },
  { value: "down", label: "故障" },
  { value: "paused", label: "已停用" },
];

const VIEW_KEY = "monitors.view";

function loadView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "card";
  } catch {
    return "card";
  }
}

function saveView(v: ViewMode) {
  try { localStorage.setItem(VIEW_KEY, v); } catch { /* 隐私模式等存不进就算了 */ }
}

function matchesFilter(m: Monitor, f: Filter): boolean {
  if (f === "") return true;
  if (f === "paused") return m.enabled !== 1;
  return m.enabled === 1 && m.status === f;
}

export default function Monitors() {
  const toast = useToast();
  const confirm = useConfirm();
  const [list, setList] = useState<Monitor[] | null>(null); // null = 首屏加载中
  const [beats, setBeats] = useState<Record<number, Heartbeat[]>>({});
  const [jobs, setJobs] = useState<Job[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [form, setForm] = useState<MonitorFormData | null>(null);
  const [snapshot, setSnapshot] = useState<MonitorFormData | null>(null);
  const [busy, setBusy] = useState(false);
  const [probingId, setProbingId] = useState<number | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [view, setView] = useState<ViewMode>(loadView);
  const [retention, setRetention] = useState(30);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  // 筛选状态同步进 URL（?status=down）：仪表盘监控卡的副行可直达故障筛选
  const [params, setParams] = useSearchParams();
  const rawFilter = params.get("status") ?? "";
  const filter: Filter = FILTER_OPTIONS.some(o => o.value !== "" && o.value === rawFilter)
    ? (rawFilter as Filter)
    : "";
  const alive = useAlive();

  async function load() {
    const [monitors, recentBeats] = await Promise.all([
      get<Monitor[]>("/api/monitors"),
      get<Record<number, Heartbeat[]>>("/api/monitors/beats?per=40"),
    ]);
    if (!alive.current) return;
    setList(monitors);
    setBeats(recentBeats);
  }

  useEffect(() => {
    load().catch(e => toast(errText(e), "err"));
    get<Job[]>("/api/jobs").then(j => { if (alive.current) setJobs(j); }).catch(() => {});
    get<{ channels: Channel[] }>("/api/notify/channels").then(d => { if (alive.current) setChannels(d.channels); }).catch(() => {});
    get<{ days: number }>("/api/monitors/retention").then(d => { if (alive.current) setRetention(d.days); }).catch(() => {});
  }, []);

  // 自动刷新（60 秒）；表单打开时暂停，避免与表单快照竞态
  useAutoRefresh(() => { load().catch(() => {}); }, 60_000, !form && detailId === null);

  function open(data: MonitorFormData) {
    setForm(data);
    setSnapshot(data); // 脏态判定的基准
  }

  function edit(m: Monitor) {
    let channelIds: number[] | null = null;
    try {
      const parsed = JSON.parse(m.notify_channel_ids ?? "null") as unknown;
      channelIds = Array.isArray(parsed) ? parsed.filter((x): x is number => typeof x === "number") : null;
    } catch { /* 损坏按全部渠道处理 */ }
    open({
      id: m.id, name: m.name, url: m.url, method: m.method,
      expected_status: m.expected_status, keyword: m.keyword ?? "",
      headers_json: m.headers_json ?? "",
      timeout_sec: Math.round(m.timeout_ms / 1000),
      interval_min: Math.round(m.interval_seconds / 60),
      fail_threshold: m.fail_threshold,
      pause_start: m.pause_start ?? "", pause_end: m.pause_end ?? "",
      timezone: m.timezone ?? LOCAL_TZ,
      notify: m.notify ?? 0, channelIds,
      on_down_job_id: m.on_down_job_id ?? 0, on_up_job_id: m.on_up_job_id ?? 0,
    });
  }

  async function submit() {
    if (!form) return;
    setBusy(true);
    // 表单不含 enabled；编辑时回传原有启用状态，避免停用的监控被静默重新启用
    const editing = form.id ? list?.find(m => m.id === form.id) : undefined;
    const { channelIds, ...rest } = form;
    const body = {
      ...rest,
      keyword: rest.keyword.trim(),
      headers_json: rest.headers_json.trim(),
      timeout_ms: rest.timeout_sec * 1000,
      interval_seconds: rest.interval_min * 60,
      pause_start: rest.pause_start || null,
      pause_end: rest.pause_end || null,
      timezone: rest.timezone || null,
      notify_channel_ids: channelIds,
      on_down_job_id: rest.on_down_job_id || null,
      on_up_job_id: rest.on_up_job_id || null,
      enabled: editing ? editing.enabled : 1,
    };
    try {
      if (form.id) await put(`/api/monitors/${form.id}`, body);
      else await post("/api/monitors", body);
      toast(form.id ? "监控已更新" : "监控已创建");
      setForm(null);
      setSnapshot(null);
      await load();
    } catch (e) {
      toast(errText(e), "err");
    } finally {
      setBusy(false);
    }
  }

  /** 乐观启停：先翻本地，失败回滚。 */
  async function toggle(m: Monitor) {
    const patch = (fn: (x: Monitor) => Monitor) =>
      setList(l => l && l.map(x => (x.id === m.id ? fn(x) : x)));
    patch(x => ({ ...x, enabled: x.enabled === 1 ? 0 : 1 }));
    try {
      const d = await post<{ enabled: number }>(`/api/monitors/${m.id}/toggle`);
      patch(x => ({ ...x, enabled: d.enabled }));
    } catch (e) {
      patch(x => ({ ...x, enabled: m.enabled })); // 回滚到点击前的值
      toast(errText(e), "err");
    }
  }

  async function probeNow(m: Monitor) {
    setProbingId(m.id);
    try {
      const d = await post<ProbeOutcome>(`/api/monitors/${m.id}/probe`);
      const link = d.linkJobName ? `，已联动触发「${d.linkJobName}」` : "";
      if (d.result.status === "up") {
        toast(`检测成功：HTTP ${d.result.http_status ?? "-"} · ${d.result.latency_ms}ms${link}`);
      } else {
        toast(`检测失败：${d.result.error ?? "未知错误"}${link}`, "err");
      }
      if (d.linkError) toast(`联动任务触发失败：${d.linkError}`, "err");
      await load().catch(() => {});
    } catch (e) {
      toast(errText(e), "err");
    } finally {
      setProbingId(null);
    }
  }

  async function remove(m: Monitor) {
    const ok = await confirm({
      title: `删除监控「${m.name}」？`,
      description: "该监控的全部心跳记录会一并删除，且无法恢复。",
      confirmText: "删除",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await del(`/api/monitors/${m.id}`);
      toast("已删除");
      if (detailId === m.id) setDetailId(null);
      await load();
    } catch (e) {
      toast(errText(e), "err");
    }
  }

  // 改筛选写回 URL（replace 不产生历史记录），外部链接可直达某个筛选态
  function patchFilter(v: Filter) {
    const q = new URLSearchParams(params);
    if (v) q.set("status", v); else q.delete("status");
    setParams(q, { replace: true });
  }

  const dirty = !!form && !!snapshot && JSON.stringify(form) !== JSON.stringify(snapshot);
  const detail = detailId === null ? null : (list ?? []).find(m => m.id === detailId) ?? null;

  // list 为 null（首屏加载中）时 filtered 是空数组，加载骨架屏由 list === null 分支负责
  const filtered = (list ?? []).filter(m => matchesFilter(m, filter));

  return (
    <div>
      <PageHeader
        title="心跳监控"
        description="周期性探测外部地址，离线推送告警，并可联动触发任务自动恢复。"
        action={
          <div className="flex items-center gap-2">
            <Button variant="secondary" icon={<Trash2 className="size-4" />} onClick={() => setCleanupOpen(true)}>
              清理心跳
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => open({ ...EMPTY_FORM })}>
              新建监控
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          label="展示方式"
          value={view}
          options={[{ value: "card", label: "卡片" }, { value: "list", label: "列表" }]}
          onChange={v => { setView(v); saveView(v); }}
        />
        <Segmented label="状态筛选" value={filter} options={FILTER_OPTIONS} onChange={patchFilter} />
      </div>

      {list === null ? (
        view === "card" ? (
          <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(340px,1fr))]" aria-busy="true">
            {[0, 1, 2, 3, 4, 5].map(i => <SkeletonCard key={i} />)}
          </div>
        ) : (
          <TableShell><SkeletonRows /></TableShell>
        )
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Inbox className="size-6" />}
          title="还没有监控"
          description="添加第一个监控，持续盯着外部服务的可用性，离线自动告警或触发恢复任务。"
          action={
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => open({ ...EMPTY_FORM })}>
              新建监控
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Inbox className="size-6" />}
          title="该筛选下暂无监控"
          description="换个状态试试。"
        />
      ) : view === "card" ? (
        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(340px,1fr))]">
          {filtered.map(m => (
            <MonitorCard key={m.id}
              monitor={m}
              beats={beats[m.id]}
              probing={probingId === m.id}
              onToggle={() => void toggle(m)}
              onProbe={() => void probeNow(m)}
              onEdit={() => edit(m)}
              onRemove={() => void remove(m)}
              onDetail={() => setDetailId(m.id)}
            />
          ))}
        </div>
      ) : (
        <TableShell>
          {filtered.map(m => (
            <MonitorRow key={m.id}
              monitor={m}
              beats={beats[m.id]}
              probing={probingId === m.id}
              onToggle={() => void toggle(m)}
              onProbe={() => void probeNow(m)}
              onEdit={() => edit(m)}
              onRemove={() => void remove(m)}
              onDetail={() => setDetailId(m.id)}
            />
          ))}
        </TableShell>
      )}

      {form && (
        <MonitorForm
          open
          form={form}
          jobs={jobs}
          channels={channels}
          busy={busy}
          dirty={dirty}
          onChange={setForm}
          onClose={() => { setForm(null); setSnapshot(null); }}
          onSubmit={() => void submit()}
        />
      )}

      {detail && (
        <MonitorDetail monitor={detail} onClose={() => setDetailId(null)} />
      )}

      <MonitorsCleanupDialog
        open={cleanupOpen}
        retentionDays={retention}
        onClose={() => setCleanupOpen(false)}
        onRetentionChanged={setRetention}
        onCleaned={() => void load().catch(() => {})}
      />
    </div>
  );
}

const TH = "p-3 text-left text-xs font-medium text-fg-muted whitespace-nowrap";
const TH_CENTER = "p-3 text-center text-xs font-medium text-fg-muted whitespace-nowrap";

/** 列表视图的表格外壳（真实行与骨架行共用一套 thead）。
 * 监控/最近心跳两列给固定宽度提示：前者防止长 URL 吃掉全部富余空间把状态列挤远，
 * 后者保证心跳条带有足够宽度（条带是 w-full 的弹性内容，列宽须由列头锚定）。 */
function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-panel">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className={cx(TH, "w-60 py-2.5 pl-4")}>监控</th>
            <th className={TH_CENTER}>状态</th>
            <th className={cx(TH, "w-64")}>最近心跳</th>
            <th className={TH}>在线率 / 延迟</th>
            <th className={TH}>探测</th>
            <th className={TH_CENTER}>启用</th>
            <th className={TH_CENTER}>操作</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function SkeletonRows() {
  return (
    <>
      {[0, 1, 2, 3].map(i => (
        <tr key={i} className="border-b border-border/60 last:border-0">
          <td className="py-3.5 pl-4 pr-3"><Skeleton className="h-4 w-28" /></td>
          <td className="p-3"><div className="flex justify-center"><Skeleton className="h-5 w-12 rounded-full" /></div></td>
          <td className="p-3"><Skeleton className="h-5 w-full" /></td>
          <td className="p-3"><Skeleton className="h-4 w-20" /></td>
          <td className="p-3"><Skeleton className="h-4 w-24" /></td>
          <td className="p-3"><div className="flex justify-center"><Skeleton className="h-5 w-9 rounded-full" /></div></td>
          <td className="p-3"><div className="flex justify-center"><Skeleton className="h-4 w-16" /></div></td>
        </tr>
      ))}
    </>
  );
}
