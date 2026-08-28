import { useEffect, useState } from "react";
import { del, fmtTime, get, post, put } from "../api";
import { useToast } from "../components/Toast";
import type { Account, Job, Schedule } from "../types";

type FormData = {
  id?: number;
  name: string;
  account_id: number;
  repo: string;
  trigger_type: "workflow_dispatch" | "repository_dispatch";
  workflow_id: string;
  event_type: string;
  ref: string;
  inputs_json: string;
  schedule: Schedule;
};

const EMPTY: FormData = {
  name: "", account_id: 0, repo: "", trigger_type: "workflow_dispatch",
  workflow_id: "", event_type: "", ref: "main", inputs_json: "",
  schedule: { type: "interval", mode: "fixed", value: 45, unit: "m" },
};

function parseSchedule(json: string): Schedule {
  try { return JSON.parse(json) as Schedule; } catch { return EMPTY.schedule; }
}

function describeLocal(s: Schedule): string {
  if (s.type === "cron") return `cron ${s.expr ?? ""}（UTC）`;
  const u = { m: "分钟", h: "小时", d: "天" }[s.unit ?? "m"];
  if (s.mode === "random") return `每 ${s.min}~${s.max} ${u}（随机）`;
  return `每 ${s.value} ${u}`;
}

function ScheduleEditor({ value, onChange }: { value: Schedule; onChange: (s: Schedule) => void }) {
  const [preview, setPreview] = useState<string[]>([]);
  const [previewErr, setPreviewErr] = useState("");
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const data = await get<{ times: number[] }>(`/api/cron/preview?rule=${encodeURIComponent(JSON.stringify(value))}`);
        setPreview(data.times.map(fmtTime));
        setPreviewErr("");
      } catch (err) {
        setPreview([]);
        setPreviewErr((err as Error).message);
      }
    }, 400); // 防抖
    return () => clearTimeout(t);
  }, [JSON.stringify(value)]);

  const inputCls = "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800";
  return (
    <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="mb-3 flex gap-2 text-sm">
        {[
          ["interval", "间隔"], ["cron", "cron 表达式"],
        ].map(([t, label]) => (
          <button key={t} type="button" onClick={() =>
            onChange(t === "cron"
              ? { type: "cron", expr: "30 3 * * *" }
              : { type: "interval", mode: "fixed", value: 45, unit: "m" })
          } className={`rounded-lg px-3 py-1.5 ${value.type === t ? "bg-indigo-600 text-white" : "border border-neutral-300 dark:border-neutral-700"}`}>
            {label}
          </button>
        ))}
      </div>

      {value.type === "cron" ? (
        <div>
          <input className={inputCls} value={value.expr ?? ""} placeholder="分 时 日 月 周（UTC），如 30 3 * * *"
            onChange={e => onChange({ ...value, expr: e.target.value })} />
          <p className="mt-1 text-xs text-neutral-500">支持 *、*/n、a-b、逗号列表。按 UTC 时区计算。</p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select className={inputCls + " w-28"} value={value.mode} onChange={e => onChange({ ...value, mode: e.target.value as "fixed" | "random", ...(e.target.value === "random" ? { min: 30, max: 90 } : { value: 45 }) })}>
            <option value="fixed">固定间隔</option>
            <option value="random">随机间隔</option>
          </select>
          {value.mode === "random" ? (
            <>
              <input type="number" min={1} className={inputCls + " w-24"} value={value.min ?? 30} onChange={e => onChange({ ...value, min: Number(e.target.value) })} />
              <span>~</span>
              <input type="number" min={1} className={inputCls + " w-24"} value={value.max ?? 90} onChange={e => onChange({ ...value, max: Number(e.target.value) })} />
            </>
          ) : (
            <input type="number" min={1} className={inputCls + " w-24"} value={value.value ?? 45} onChange={e => onChange({ ...value, value: Number(e.target.value) })} />
          )}
          <select className={inputCls + " w-20"} value={value.unit ?? "m"} onChange={e => onChange({ ...value, unit: e.target.value as "m" | "h" | "d" })}>
            <option value="m">分钟</option>
            <option value="h">小时</option>
            <option value="d">天</option>
          </select>
        </div>
      )}

      <div className="mt-3 text-xs">
        {previewErr
          ? <span className="text-red-500">{previewErr}</span>
          : <div className="text-neutral-500">
              未来触发时间：
              <ul className="mt-1 list-inside list-disc font-mono">{preview.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>}
      </div>
    </div>
  );
}

export default function Jobs() {
  const toast = useToast();
  const [list, setList] = useState<Job[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [form, setForm] = useState<FormData | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setList(await get<Job[]>("/api/jobs"));
  }
  useEffect(() => {
    load();
    get<Account[]>("/api/accounts").then(setAccounts);
  }, []);

  function edit(j: Job) {
    setForm({
      id: j.id, name: j.name, account_id: j.account_id, repo: j.repo,
      trigger_type: j.trigger_type, workflow_id: j.workflow_id ?? "",
      event_type: j.event_type ?? "", ref: j.ref ?? "main",
      inputs_json: j.inputs_json ?? "", schedule: parseSchedule(j.schedule_json),
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    // 表单不含 enabled，而后端缺省会置为 1；编辑时必须回传原有启用状态，否则停用的任务会被静默重新启用。
    const editing = form.id ? list.find(j => j.id === form.id) : undefined;
    const body = { ...form, enabled: editing ? editing.enabled : 1 };
    try {
      if (form.id) await put(`/api/jobs/${form.id}`, body);
      else await post("/api/jobs", body);
      toast(form.id ? "任务已更新" : "任务已创建");
      setForm(null);
      await load();
    } catch (err) {
      toast((err as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(j: Job) {
    await post(`/api/jobs/${j.id}/toggle`);
    await load();
  }
  async function triggerNow(j: Job) {
    try {
      await post(`/api/jobs/${j.id}/trigger`);
      toast(`已触发：${j.name}`);
    } catch (err) {
      toast((err as Error).message, "err");
    }
  }
  async function remove(j: Job) {
    if (!confirm(`删除任务「${j.name}」？其运行记录会一并删除。`)) return;
    await del(`/api/jobs/${j.id}`);
    toast("已删除");
    await load();
  }

  const inputCls = "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800";
  const labelCls = "mb-1 block text-sm";

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">定时任务</h1>
        <button onClick={() => setForm({ ...EMPTY })} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-500">+ 新建任务</button>
      </div>

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500 dark:border-neutral-800">
            <tr>
              <th className="p-3">任务</th><th className="p-3">账号</th><th className="p-3">仓库</th>
              <th className="p-3">触发</th><th className="p-3">调度</th><th className="p-3">下次运行</th>
              <th className="p-3">上次运行</th><th className="p-3">状态</th><th className="p-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.map(j => (
              <tr key={j.id} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800/50">
                <td className="p-3 font-medium">{j.name}</td>
                <td className="p-3">{j.account_name ?? "-"}</td>
                <td className="p-3 font-mono text-xs">{j.repo}</td>
                <td className="p-3 text-xs">{j.trigger_type === "workflow_dispatch" ? `${j.workflow_id}@${j.ref}` : j.event_type}</td>
                <td className="p-3 text-xs">{describeLocal(parseSchedule(j.schedule_json))}</td>
                <td className="p-3 text-xs">{fmtTime(j.next_run_at)}</td>
                <td className="p-3 text-xs">{fmtTime(j.last_run_at)}</td>
                <td className="p-3">
                  <button onClick={() => toggle(j)}
                    className={`h-5 w-9 rounded-full transition-colors ${j.enabled ? "bg-emerald-500" : "bg-neutral-300 dark:bg-neutral-700"}`}>
                    <span className={`block h-4 w-4 translate-y-0.5 rounded-full bg-white transition-transform ${j.enabled ? "translate-x-4 ml-0.5" : "translate-x-0.5"}`} />
                  </button>
                </td>
                <td className="p-3">
                  <div className="flex gap-1 text-xs">
                    <button onClick={() => triggerNow(j)} className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">立即触发</button>
                    <button onClick={() => edit(j)} className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">编辑</button>
                    <button onClick={() => remove(j)} className="rounded border border-red-300 px-2 py-1 text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950">删除</button>
                  </div>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={9} className="p-6 text-center text-neutral-500">还没有任务，点击右上角新建。</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={() => setForm(null)}>
          <form onSubmit={submit} onClick={e => e.stopPropagation()}
            className="h-full w-[480px] max-w-full overflow-y-auto bg-white p-6 dark:bg-neutral-900">
            <h2 className="mb-4 text-lg font-bold">{form.id ? "编辑任务" : "新建任务"}</h2>

            <label className={labelCls}>任务名</label>
            <input className={inputCls + " mb-3"} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />

            <label className={labelCls}>GitHub 账号</label>
            <select className={inputCls + " mb-3"} value={form.account_id} onChange={e => setForm({ ...form, account_id: Number(e.target.value) })}>
              <option value={0}>请选择…</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}{a.github_login ? `（@${a.github_login}）` : ""}</option>)}
            </select>

            <label className={labelCls}>仓库（owner/repo）</label>
            <input className={inputCls + " mb-3"} value={form.repo} placeholder="alice/repo1" onChange={e => setForm({ ...form, repo: e.target.value })} />

            <label className={labelCls}>触发方式</label>
            <div className="mb-3 flex gap-2 text-sm">
              {(["workflow_dispatch", "repository_dispatch"] as const).map(t => (
                <button key={t} type="button" onClick={() => setForm({ ...form, trigger_type: t })}
                  className={`rounded-lg px-3 py-1.5 ${form.trigger_type === t ? "bg-indigo-600 text-white" : "border border-neutral-300 dark:border-neutral-700"}`}>
                  {t}
                </button>
              ))}
            </div>

            {form.trigger_type === "workflow_dispatch" ? (
              <>
                <label className={labelCls}>Workflow 文件名 / ID</label>
                <input className={inputCls + " mb-3"} value={form.workflow_id} placeholder="如 run.yml" onChange={e => setForm({ ...form, workflow_id: e.target.value })} />
                <label className={labelCls}>分支 / Ref</label>
                <input className={inputCls + " mb-3"} value={form.ref} onChange={e => setForm({ ...form, ref: e.target.value })} />
              </>
            ) : (
              <>
                <label className={labelCls}>事件类型（event_type）</label>
                <input className={inputCls + " mb-3"} value={form.event_type} placeholder="如 cron" onChange={e => setForm({ ...form, event_type: e.target.value })} />
              </>
            )}

            <label className={labelCls}>inputs / payload（JSON 对象，可留空）</label>
            <textarea className={inputCls + " mb-3 font-mono text-xs"} rows={3} value={form.inputs_json}
              placeholder='{"key":"value"}' onChange={e => setForm({ ...form, inputs_json: e.target.value })} />

            <label className={labelCls}>调度规则</label>
            <div className="mb-4">
              <ScheduleEditor value={form.schedule} onChange={s => setForm({ ...form, schedule: s })} />
            </div>

            <div className="flex gap-2">
              <button disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-500 disabled:opacity-50">
                {busy ? "保存中…" : "保存"}
              </button>
              <button type="button" onClick={() => setForm(null)} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm dark:border-neutral-700">取消</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
