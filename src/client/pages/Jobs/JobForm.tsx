import { useEffect, useState, type ReactNode } from "react";
import { errText, get } from "../../api";
import { CHANNEL_TYPE_LABEL, type Account, type Channel, type Schedule } from "../../types";
import { Badge, Button, Checkbox, Drawer, Field, Input, Segmented, Select, Switch, Textarea } from "../../ui";
import { validateInputsJson, validateRepo } from "../../utils/validate";
import { EMPTY_SCHEDULE, LOCAL_TZ } from "./schedule";
import ScheduleEditor from "./ScheduleEditor";

type WorkflowItem = { id: string; name: string; path: string; state: string };

export type JobFormData = {
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
  notify: number;
  /** 失败通知渠道多选；null = 全部渠道（含以后新增的） */
  channelIds: number[] | null;
  timezone: string;
};

export const EMPTY_FORM: JobFormData = {
  name: "", account_id: 0, repo: "", trigger_type: "workflow_dispatch",
  workflow_id: "", event_type: "", ref: "main", inputs_json: "",
  schedule: EMPTY_SCHEDULE, notify: 0, channelIds: null, timezone: LOCAL_TZ,
};

type Key = "name" | "account_id" | "repo" | "workflow_id" | "event_type" | "inputs_json";

const ALL_TOUCHED: Record<Key, boolean> = {
  name: true, account_id: true, repo: true,
  workflow_id: true, event_type: true, inputs_json: true,
};

/** 全部校验规则集中在这里。合法为 null，否则为中文文案。 */
function validate(f: JobFormData): Record<Key, string | null> {
  return {
    name: f.name.trim() ? null : "任务名不能为空",
    account_id: f.account_id > 0 ? null : "请选择账号",
    repo: validateRepo(f.repo),
    workflow_id: f.trigger_type === "workflow_dispatch" && !f.workflow_id.trim()
      ? "请填写 workflow 文件名（如 run.yml）或 ID" : null,
    event_type: f.trigger_type === "repository_dispatch" && !f.event_type.trim()
      ? "请填写 repository_dispatch 事件类型" : null,
    inputs_json: validateInputsJson(f.inputs_json),
  };
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="mb-3 text-xs font-semibold tracking-wide text-fg-subtle uppercase">{title}</h3>
      {children}
    </section>
  );
}

type Props = {
  open: boolean;
  form: JobFormData;
  accounts: Account[];
  channels: Channel[];
  busy: boolean;
  /** 由父组件对比快照算出，交给 Drawer 决定是否二次确认 */
  dirty: boolean;
  onChange: (next: JobFormData) => void;
  onClose: () => void;
  onSubmit: () => void;
};

export default function JobForm({
  open, form, accounts, channels, busy, dirty, onChange, onClose, onSubmit,
}: Props) {
  const [touched, setTouched] = useState<Partial<Record<Key, boolean>>>({});
  const [schedErr, setSchedErr] = useState<string | null>(null);

  const errors = validate(form);
  const blocked = Object.values(errors).some(Boolean) || !!schedErr;
  const set = (patch: Partial<JobFormData>) => onChange({ ...form, ...patch });
  const touch = (k: Key) => () => setTouched(t => ({ ...t, [k]: true }));
  const err = (k: Key) => (touched[k] ? errors[k] : null);

  // ---- workflow 列表：账号 + 仓库就绪后防抖拉取，失败退回手动输入 ----
  const [workflows, setWorkflows] = useState<WorkflowItem[] | null>(null);
  const [wfErr, setWfErr] = useState("");
  const [manualWorkflow, setManualWorkflow] = useState(false);
  const repoReady = form.trigger_type === "workflow_dispatch" && form.account_id > 0 && validateRepo(form.repo) === null;

  useEffect(() => {
    if (!repoReady) { setWorkflows(null); setWfErr(""); return; }
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const d = await get<{ workflows: WorkflowItem[] }>(
          `/api/github/workflows?account_id=${form.account_id}&repo=${encodeURIComponent(form.repo.trim())}`,
        );
        if (alive) { setWorkflows(d.workflows); setWfErr(""); }
      } catch (e) {
        if (alive) { setWorkflows(null); setWfErr(errText(e)); }
      }
    }, 300); // 与 cron 预览一致的防抖
    return () => { alive = false; clearTimeout(t); };
  }, [form.account_id, form.repo, repoReady]);

  const wfFromList = !!workflows && workflows.some(w => w.id === form.workflow_id);

  // 失败通知多选：全部渠道 = null；开关开着但一个渠道都没勾 → 阻止保存
  const notifyError = form.notify === 1 && channels.length > 0
    && form.channelIds !== null && form.channelIds.length === 0
    ? "请至少勾选一个渠道，或勾选「全部渠道」"
    : null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // 点保存时把所有字段标记为已触碰，漏填的字段一次性全部亮红，而不是逐个试。
    setTouched(ALL_TOUCHED);
    if (blocked || notifyError) return;
    onSubmit();
  }

  return (
    <Drawer open={open} onClose={onClose} dirty={dirty}
      title={form.id ? "编辑任务" : "新建任务"}>
      <form onSubmit={submit} noValidate>
        <Group title="基本信息">
          <Field label="任务名" error={err("name")}>
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} invalid={!!err("name")}
                value={form.name} onBlur={touch("name")}
                onChange={e => set({ name: e.target.value })} />
            )}
          </Field>
          <Field label="GitHub 账号" error={err("account_id")}>
            {({ id, describedBy }) => (
              <Select id={id} aria-describedby={describedBy} invalid={!!err("account_id")}
                value={form.account_id} onBlur={touch("account_id")}
                onChange={e => set({ account_id: Number(e.target.value) })}>
                <option value={0}>请选择…</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.name}{a.github_login ? `（@${a.github_login}）` : ""}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="仓库" hint="格式 owner/repo，如 alice/repo1" error={err("repo")}>
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} invalid={!!err("repo")}
                value={form.repo} placeholder="alice/repo1" onBlur={touch("repo")}
                onChange={e => set({ repo: e.target.value })} />
            )}
          </Field>
          <div>
            {/* 标题与开关同行，不嵌套 Field 避免出现两层「失败通知」文案；
                校验错误只在这一处显示 */}
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2.5">
              <span className="text-sm text-fg">失败通知</span>
              <Switch checked={form.notify === 1} label="失败通知"
                onChange={v => set({ notify: v ? 1 : 0 })} />
            </div>
            {form.notify === 1 && (channels.length > 0 ? (
              // 勾选范围：「全部」是快捷项（含以后新增的渠道）；
              // 取消全部后可逐个勾选，一个都不勾时保存被阻止
              <div className="mt-2 space-y-2 rounded-lg border border-border px-3 py-2.5">
                <Checkbox checked={form.channelIds === null}
                  onChange={on => set({ channelIds: on ? null : channels.map(ch => ch.id) })}>
                  全部渠道
                </Checkbox>
                {form.channelIds !== null && (
                  <div className="space-y-2 border-t border-border/60 pt-2">
                    {channels.map(ch => (
                      <Checkbox key={ch.id} checked={form.channelIds!.includes(ch.id)}
                        onChange={on => set({
                          channelIds: on
                            ? [...form.channelIds!, ch.id]
                            : form.channelIds!.filter(id => id !== ch.id),
                        })}>
                        <span className="inline-flex max-w-full items-center gap-2">
                          <span className="truncate">{ch.name}</span>
                          <Badge>{CHANNEL_TYPE_LABEL[ch.type]}</Badge>
                        </span>
                      </Checkbox>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-2 text-xs text-fg-subtle">
                还没有通知渠道。到「账户 → 通知设置」添加后即可选择推送目标；自动停用不受此影响。
              </p>
            ))}
            {notifyError && <p role="alert" className="mt-2 text-xs text-danger">{notifyError}</p>}
          </div>
        </Group>

        <Group title="触发方式">
          <div className="mb-4">
            <Segmented
              label="触发方式"
              value={form.trigger_type}
              options={[
                { value: "workflow_dispatch", label: "workflow_dispatch" },
                { value: "repository_dispatch", label: "repository_dispatch" },
              ]}
              onChange={trigger_type => set({ trigger_type })}
            />
          </div>

          {form.trigger_type === "workflow_dispatch" ? (
            <>
              {workflows && workflows.length > 0 && !manualWorkflow ? (
                <Field label="选择 Workflow" hint="也可改为手动输入文件名或数字 ID"
                  error={err("workflow_id")}>
                  {({ id, describedBy }) => (
                    <Select id={id} aria-describedby={describedBy} invalid={!!err("workflow_id")}
                      value={wfFromList ? form.workflow_id : ""}
                      onBlur={touch("workflow_id")}
                      onChange={e => {
                        if (e.target.value === "") { setManualWorkflow(true); return; }
                        set({ workflow_id: e.target.value });
                      }}>
                      <option value="">手动输入…</option>
                      {!wfFromList && form.workflow_id && (
                        <option value={form.workflow_id}>当前：{form.workflow_id}</option>
                      )}
                      {workflows.map(w => (
                        <option key={w.id} value={w.id}>
                          {w.name ? `${w.name}（${w.path}）` : w.path}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : (
                <Field label="Workflow 文件名 / ID"
                  hint="如 run.yml；也可填 workflow 数字 ID"
                  error={err("workflow_id")}>
                  {({ id, describedBy }) => (
                    <Input id={id} aria-describedby={describedBy} invalid={!!err("workflow_id")}
                      value={form.workflow_id} placeholder="run.yml" onBlur={touch("workflow_id")}
                      onChange={e => set({ workflow_id: e.target.value })} />
                  )}
                </Field>
              )}
              {workflows && workflows.length > 0 && manualWorkflow && (
                <button type="button" onClick={() => setManualWorkflow(false)}
                  className="-mt-2 mb-4 text-xs text-fg-muted underline-offset-2 hover:underline">
                  改为从列表选择
                </button>
              )}
              {!workflows && repoReady && (
                <p className="-mt-2 mb-4 text-xs text-fg-subtle">
                  {wfErr ? `无法获取 workflow 列表：${wfErr}，可手动输入文件名。` : "正在获取 workflow 列表…"}
                </p>
              )}
              <Field label="分支 / Ref">
                {({ id }) => (
                  <Input id={id} value={form.ref}
                    onChange={e => set({ ref: e.target.value })} />
                )}
              </Field>
            </>
          ) : (
            <Field label="事件类型（event_type）" error={err("event_type")}>
              {({ id, describedBy }) => (
                <Input id={id} aria-describedby={describedBy} invalid={!!err("event_type")}
                  value={form.event_type} placeholder="cron" onBlur={touch("event_type")}
                  onChange={e => set({ event_type: e.target.value })} />
              )}
            </Field>
          )}

          <Field label="inputs / payload" hint="JSON 对象，可留空" error={err("inputs_json")}>
            {({ id, describedBy }) => (
              <Textarea id={id} aria-describedby={describedBy} invalid={!!err("inputs_json")}
                rows={3} className="font-mono text-xs" value={form.inputs_json}
                placeholder='{"key":"value"}' onBlur={touch("inputs_json")}
                onChange={e => set({ inputs_json: e.target.value })} />
            )}
          </Field>
        </Group>

        <Group title="调度规则">
          <ScheduleEditor value={form.schedule} timezone={form.timezone}
            onTimezoneChange={tz => set({ timezone: tz })}
            onError={setSchedErr}
            onChange={schedule => set({ schedule })} />
        </Group>

        <div className="sticky bottom-0 -mx-5 flex gap-2 border-t border-border bg-panel px-5 py-3">
          <Button type="submit" variant="primary" loading={busy} disabled={form.account_id === 0}>保存</Button>
          <Button type="button" variant="secondary" onClick={onClose}>取消</Button>
        </div>
      </form>
    </Drawer>
  );
}
