import { useEffect, useState } from "react";
import { del, get, post, put } from "../../api";
import PageHeader from "../../components/PageHeader";
import { useToast } from "../../components/Toast";
import type { Account, Job, Run } from "../../types";
import { Button, EmptyState, SkeletonCard, useConfirm } from "../../ui";
import { Inbox, Plus } from "../../ui/icons";
import JobForm, { EMPTY_FORM, type JobFormData } from "./JobForm";
import JobRow from "./JobRow";
import { parseSchedule } from "./schedule";

export default function Jobs() {
  const toast = useToast();
  const confirm = useConfirm();
  const [list, setList] = useState<Job[] | null>(null); // null = 首屏加载中
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [lastRuns, setLastRuns] = useState<Record<number, Run>>({});
  const [form, setForm] = useState<JobFormData | null>(null);
  const [snapshot, setSnapshot] = useState<JobFormData | null>(null);
  const [busy, setBusy] = useState(false);
  const [triggering, setTriggering] = useState<number | null>(null);

  async function load() {
    const [jobs, runs] = await Promise.all([
      get<Job[]>("/api/jobs"),
      get<{ rows: Run[] }>("/api/runs?page=1"),
    ]);
    // runs 按 triggered_at DESC，首次出现即该任务的最新一条
    const latest: Record<number, Run> = {};
    for (const r of runs.rows) if (!latest[r.job_id]) latest[r.job_id] = r;
    setList(jobs);
    setLastRuns(latest);
  }

  useEffect(() => {
    load().catch(e => toast((e as Error).message, "err"));
    get<Account[]>("/api/accounts").then(setAccounts).catch(() => {});
  }, []);

  function open(data: JobFormData) {
    setForm(data);
    setSnapshot(data); // 脏态判定的基准
  }

  function edit(j: Job) {
    open({
      id: j.id, name: j.name, account_id: j.account_id, repo: j.repo,
      trigger_type: j.trigger_type, workflow_id: j.workflow_id ?? "",
      event_type: j.event_type ?? "", ref: j.ref ?? "main",
      inputs_json: j.inputs_json ?? "", schedule: parseSchedule(j.schedule_json),
    });
  }

  async function submit() {
    if (!form) return;
    setBusy(true);
    // 表单不含 enabled，而后端缺省会置为 1；编辑时必须回传原有启用状态，
    // 否则停用的任务会被静默重新启用。
    const editing = form.id ? list?.find(j => j.id === form.id) : undefined;
    const body = { ...form, enabled: editing ? editing.enabled : 1 };
    try {
      if (form.id) await put(`/api/jobs/${form.id}`, body);
      else await post("/api/jobs", body);
      toast(form.id ? "任务已更新" : "任务已创建");
      setForm(null);
      setSnapshot(null);
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
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
      toast((e as Error).message, "err");
    }
  }

  async function triggerNow(j: Job) {
    setTriggering(j.id);
    try {
      await post(`/api/jobs/${j.id}/trigger`);
      toast(`已触发：${j.name}`);
    } catch (e) {
      toast((e as Error).message, "err");
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
      toast((e as Error).message, "err");
    }
  }

  const dirty = !!form && !!snapshot && JSON.stringify(form) !== JSON.stringify(snapshot);

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

      {list === null ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2].map(i => <SkeletonCard key={i} />)}
        </div>
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
      ) : (
        <div className="space-y-3">
          {list.map(j => (
            <JobRow
              key={j.id}
              job={j}
              lastRun={lastRuns[j.id]}
              triggering={triggering === j.id}
              onToggle={() => void toggle(j)}
              onTrigger={() => void triggerNow(j)}
              onEdit={() => edit(j)}
              onRemove={() => void remove(j)}
            />
          ))}
        </div>
      )}

      {form && (
        <JobForm
          open
          form={form}
          accounts={accounts}
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
