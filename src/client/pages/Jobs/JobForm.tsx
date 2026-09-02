import { useState, type ReactNode } from "react";
import type { Account, Schedule } from "../../types";
import { Button, Drawer, Field, Input, Segmented, Select, Textarea } from "../../ui";
import { validateInputsJson, validateRepo } from "../../utils/validate";
import { EMPTY_SCHEDULE } from "./schedule";
import ScheduleEditor from "./ScheduleEditor";

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
};

export const EMPTY_FORM: JobFormData = {
  name: "", account_id: 0, repo: "", trigger_type: "workflow_dispatch",
  workflow_id: "", event_type: "", ref: "main", inputs_json: "",
  schedule: EMPTY_SCHEDULE,
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
  busy: boolean;
  /** 由父组件对比快照算出，交给 Drawer 决定是否二次确认 */
  dirty: boolean;
  onChange: (next: JobFormData) => void;
  onClose: () => void;
  onSubmit: () => void;
};

export default function JobForm({
  open, form, accounts, busy, dirty, onChange, onClose, onSubmit,
}: Props) {
  const [touched, setTouched] = useState<Partial<Record<Key, boolean>>>({});
  const [schedErr, setSchedErr] = useState<string | null>(null);

  const errors = validate(form);
  const blocked = Object.values(errors).some(Boolean) || !!schedErr;
  const set = (patch: Partial<JobFormData>) => onChange({ ...form, ...patch });
  const touch = (k: Key) => () => setTouched(t => ({ ...t, [k]: true }));
  const err = (k: Key) => (touched[k] ? errors[k] : null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // 点保存时把所有字段标记为已触碰，漏填的字段一次性全部亮红，而不是逐个试。
    setTouched(ALL_TOUCHED);
    if (blocked) return;
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
              <Field label="Workflow 文件名 / ID" error={err("workflow_id")}>
                {({ id, describedBy }) => (
                  <Input id={id} aria-describedby={describedBy} invalid={!!err("workflow_id")}
                    value={form.workflow_id} placeholder="run.yml" onBlur={touch("workflow_id")}
                    onChange={e => set({ workflow_id: e.target.value })} />
                )}
              </Field>
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
          <ScheduleEditor value={form.schedule} onError={setSchedErr}
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
