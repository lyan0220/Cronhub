import { useEffect, useState } from "react";
import { del, errText, get, post, put } from "../../api";
import PageHeader from "../../components/PageHeader";
import { useToast } from "../../components/Toast";
import type { Account, Channel, Job, Run } from "../../types";
import { Button, EmptyState, Segmented, Select, Skeleton, SkeletonCard, useConfirm } from "../../ui";
import { cx } from "../../ui/styles";
import { Inbox, Plus } from "../../ui/icons";
import JobCard from "./JobCard";
import JobForm, { EMPTY_FORM, type JobFormData } from "./JobForm";
import JobRow from "./JobRow";
import { parseSchedule } from "./schedule";
import { useAlive } from "../../utils/useAlive";
import { useAutoRefresh } from "../../utils/useAutoRefresh";

type ViewMode = "card" | "list";

const VIEW_KEY = "jobs.view";

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

export default function Jobs() {
  const toast = useToast();
  const confirm = useConfirm();
  const [list, setList] = useState<Job[] | null>(null); // null = 首屏加载中
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [lastRuns, setLastRuns] = useState<Record<number, Run>>({});
  const [form, setForm] = useState<JobFormData | null>(null);
  const [snapshot, setSnapshot] = useState<JobFormData | null>(null);
  const [busy, setBusy] = useState(false);
  const [triggering, setTriggering] = useState<number | null>(null);
  const [view, setView] = useState<ViewMode>(loadView);
  const [accountId, setAccountId] = useState(0); // 0 = 全部账号
  const alive = useAlive();

  async function load() {
    const [jobs, runs] = await Promise.all([
      get<Job[]>("/api/jobs"),
      get<{ rows: Run[] }>("/api/runs?page=1"),
    ]);
    if (!alive.current) return;
    // runs 按 triggered_at DESC，首次出现即该任务的最新一条
    const latest: Record<number, Run> = {};
    for (const r of runs.rows) if (!latest[r.job_id]) latest[r.job_id] = r;
    setList(jobs);
    setLastRuns(latest);
  }

  useEffect(() => {
    load().catch(e => toast(errText(e), "err"));
    get<Account[]>("/api/accounts").then(a => { if (alive.current) setAccounts(a); }).catch(() => {});
    get<{ channels: Channel[] }>("/api/notify/channels").then(d => { if (alive.current) setChannels(d.channels); }).catch(() => {});
  }, []);

  // 自动刷新任务列表与最近运行（60 秒）；表单抽屉打开时暂停，避免与表单快照竞态
  useAutoRefresh(() => { load().catch(() => {}); }, 60_000, !form);

  function open(data: JobFormData) {
    setForm(data);
    setSnapshot(data); // 脏态判定的基准
  }

  function edit(j: Job) {
    let channelIds: number[] | null = null;
    try {
      const parsed = JSON.parse(j.notify_channel_ids ?? "null") as unknown;
      channelIds = Array.isArray(parsed) ? parsed.filter((x): x is number => typeof x === "number") : null;
    } catch { /* 损坏按全部渠道处理 */ }
    open({
      id: j.id, name: j.name, account_id: j.account_id, repo: j.repo,
      trigger_type: j.trigger_type, workflow_id: j.workflow_id ?? "",
      event_type: j.event_type ?? "", ref: j.ref ?? "main",
      inputs_json: j.inputs_json ?? "", schedule: parseSchedule(j.schedule_json),
      notify: j.notify ?? 0, channelIds, timezone: j.timezone ?? "",
    });
  }

  async function submit() {
    if (!form) return;
    setBusy(true);
    // 表单不含 enabled，而后端缺省会置为 1；编辑时必须回传原有启用状态，
    // 否则停用的任务会被静默重新启用。channelIds 是表单内部命名，提交时映射为
    // 服务端的 notify_channel_ids（JSON 数组，null = 全部渠道）。
    const editing = form.id ? list?.find(j => j.id === form.id) : undefined;
    const { channelIds, ...rest } = form;
    const body = { ...rest, notify_channel_ids: channelIds, enabled: editing ? editing.enabled : 1 };
    try {
      if (form.id) await put(`/api/jobs/${form.id}`, body);
      else await post("/api/jobs", body);
      toast(form.id ? "任务已更新" : "任务已创建");
      setForm(null);
      setSnapshot(null);
      await load();
    } catch (e) {
      toast(errText(e), "err");
    } finally {
      setBusy(false);
    }
  }

  /** 乐观启停：先翻本地，成功后用服务端返回的权威值覆盖，失败回滚。 */
  async function toggle(j: Job) {
    const patch = (fn: (x: Job) => Job) =>
      setList(l => l && l.map(x => (x.id === j.id ? fn(x) : x)));
    patch(x => ({ ...x, enabled: x.enabled === 1 ? 0 : 1 }));
    try {
      const d = await post<{ enabled: number; next_run_at: number }>(`/api/jobs/${j.id}/toggle`);
      patch(x => ({ ...x, enabled: d.enabled, next_run_at: d.next_run_at }));
    } catch (e) {
      patch(x => ({ ...x, enabled: j.enabled })); // 回滚到点击前的值
      toast(errText(e), "err");
    }
  }

  async function triggerNow(j: Job) {
    setTriggering(j.id);
    try {
      await post(`/api/jobs/${j.id}/trigger`);
      toast(`已触发：${j.name}`);
    } catch (e) {
      toast(errText(e), "err");
    } finally {
      setTriggering(null);
      // 成败都重拉：服务端两种情况都写了 runs 记录，
      // 卡片第四行会就地显示本次结果（含失败的 HTTP 码）。
      await load().catch(() => {});
    }
  }

  async function remove(j: Job) {
    const ok = await confirm({
      title: `删除任务「${j.name}」？`,
      description: "该任务的全部运行记录会一并删除，且无法恢复。",
      confirmText: "删除",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await del(`/api/jobs/${j.id}`);
      toast("已删除");
      await load();
    } catch (e) {
      toast(errText(e), "err");
    }
  }

  const dirty = !!form && !!snapshot && JSON.stringify(form) !== JSON.stringify(snapshot);

  // list 为 null（首屏加载中）时 filtered 是空数组，加载骨架屏由 list === null 分支负责
  const filtered = (list ?? []).filter(j => accountId === 0 || j.account_id === accountId);
  const rowProps = (j: Job) => ({
    job: j,
    lastRun: lastRuns[j.id],
    triggering: triggering === j.id,
    onToggle: () => void toggle(j),
    onTrigger: () => void triggerNow(j),
    onEdit: () => edit(j),
    onRemove: () => void remove(j),
  });

  function switchView(v: ViewMode) {
    setView(v);
    saveView(v);
  }

  return (
    <div>
      <PageHeader
        title="定时任务"
        description="按间隔或 cron 触发 GitHub Actions。"
        action={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => open({ ...EMPTY_FORM })}>
            新建任务
          </Button>
        }
      />

      {/* 工具条：视图切换（记住偏好）+ 账号筛选，与运行记录页的筛选栏同一套排布 */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          label="展示方式"
          value={view}
          options={[{ value: "card", label: "卡片" }, { value: "list", label: "列表" }]}
          onChange={switchView}
        />
        <div className="w-56">
          <Select aria-label="按账号筛选" value={accountId}
            onChange={e => setAccountId(Number(e.target.value))}>
            <option value={0}>全部账号</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </div>
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
          title="还没有任务"
          description="创建第一个任务，让 GitHub Actions 按时自己跑起来。"
          action={
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => open({ ...EMPTY_FORM })}>
              新建任务
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Inbox className="size-6" />}
          title="该账号下暂无任务"
          description="换个账号试试，或为它新建一个任务。"
        />
      ) : view === "card" ? (
        // auto-fill：列数跟着可用宽度走，宽屏一行多卡、卡片永不过分拉长
        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(340px,1fr))]">
          {filtered.map(j => <JobCard key={j.id} {...rowProps(j)} />)}
        </div>
      ) : (
        <TableShell>
          {filtered.map(j => <JobRow key={j.id} {...rowProps(j)} />)}
        </TableShell>
      )}

      {form && (
        <JobForm
          open
          form={form}
          accounts={accounts}
          channels={channels}
          busy={busy}
          dirty={dirty}
          onChange={setForm}
          onClose={() => { setForm(null); setSnapshot(null); }}
          onSubmit={() => void submit()}
        />
      )}
    </div>
  );
}

const TH = "p-3 text-left text-xs font-medium text-fg-muted whitespace-nowrap";
const TH_CENTER = "p-3 text-center text-xs font-medium text-fg-muted whitespace-nowrap";

/** 列表视图的表格外壳（真实行与骨架行共用一套 thead） */
function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-panel">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className={cx(TH, "py-2.5 pl-4")}>任务</th>
            <th className={TH}>目标</th>
            <th className={TH}>调度</th>
            <th className={TH}>上次运行</th>
            <th className={TH_CENTER}>状态</th>
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
          <td className="p-3"><Skeleton className="h-8 w-44" /></td>
          <td className="p-3"><Skeleton className="h-8 w-36" /></td>
          <td className="p-3"><Skeleton className="h-4 w-44" /></td>
          <td className="p-3"><Skeleton className="h-5 w-9 rounded-full" /></td>
          <td className="p-3"><Skeleton className="h-5 w-9 rounded-full" /></td>
          <td className="p-3"><div className="flex justify-center"><Skeleton className="h-4 w-16" /></div></td>
        </tr>
      ))}
    </>
  );
}
