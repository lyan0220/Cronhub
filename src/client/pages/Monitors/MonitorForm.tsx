import { useState, type ReactNode } from "react";
import { CHANNEL_TYPE_LABEL, type Channel, type Job } from "../../types";
import { Badge, Button, Checkbox, Drawer, Field, Input, Segmented, Select, Switch, Textarea } from "../../ui";

export type MonitorFormData = {
  id?: number;
  name: string;
  url: string;
  method: "GET" | "HEAD";
  /** 0 = 任意 2xx 即成功；其余为精确状态码 */
  expected_status: number;
  keyword: string;
  headers_json: string;
  /** 表单以秒/分钟为单位，提交时换算回 ms/seconds */
  timeout_sec: number;
  interval_min: number;
  fail_threshold: number;
  notify: number;
  /** 状态变化通知渠道多选；null = 全部渠道（含以后新增的） */
  channelIds: number[] | null;
  /** 联动任务 id；0 = 不联动 */
  on_down_job_id: number;
  on_up_job_id: number;
};

export const EMPTY_FORM: MonitorFormData = {
  name: "", url: "", method: "GET", expected_status: 0, keyword: "",
  headers_json: "", timeout_sec: 10, interval_min: 5, fail_threshold: 1,
  notify: 0, channelIds: null, on_down_job_id: 0, on_up_job_id: 0,
};

type Key = "name" | "url" | "timeout_sec" | "interval_min" | "fail_threshold" | "headers_json";

const ALL_TOUCHED: Record<Key, boolean> = {
  name: true, url: true, timeout_sec: true,
  interval_min: true, fail_threshold: true, headers_json: true,
};

function validateUrl(url: string): string | null {
  const t = url.trim();
  if (!t) return "URL 不能为空";
  try {
    const u = new URL(t);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "URL 必须是 http/https 地址";
    return null;
  } catch {
    return "URL 格式无效";
  }
}

function validateHeadersJson(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const v = JSON.parse(t) as unknown;
    if (typeof v !== "object" || v === null || Array.isArray(v)) return "必须是 JSON 对象，如 {\"X-Token\": \"abc\"}";
    if (!Object.values(v).every(x => typeof x === "string")) return "请求头的值必须是字符串";
    return null;
  } catch {
    return "不是合法的 JSON";
  }
}

/** 全部校验规则集中在这里。合法为 null，否则为中文文案。 */
function validate(f: MonitorFormData): Record<Key, string | null> {
  const intIn = (v: number, min: number, max: number) =>
    Number.isInteger(v) && v >= min && v <= max ? null : `应为 ${min}-${max} 的整数`;
  return {
    name: f.name.trim() ? null : "监控名不能为空",
    url: validateUrl(f.url),
    timeout_sec: intIn(f.timeout_sec, 1, 30),
    interval_min: intIn(f.interval_min, 2, 1440),
    fail_threshold: intIn(f.fail_threshold, 1, 10),
    headers_json: validateHeadersJson(f.headers_json),
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
  form: MonitorFormData;
  jobs: Job[];
  channels: Channel[];
  busy: boolean;
  /** 由父组件对比快照算出，交给 Drawer 决定是否二次确认 */
  dirty: boolean;
  onChange: (next: MonitorFormData) => void;
  onClose: () => void;
  onSubmit: () => void;
};

export default function MonitorForm({
  open, form, jobs, channels, busy, dirty, onChange, onClose, onSubmit,
}: Props) {
  const [touched, setTouched] = useState<Partial<Record<Key, boolean>>>({});

  const errors = validate(form);
  const blocked = Object.values(errors).some(Boolean);
  const set = (patch: Partial<MonitorFormData>) => onChange({ ...form, ...patch });
  const touch = (k: Key) => () => setTouched(t => ({ ...t, [k]: true }));
  const err = (k: Key) => (touched[k] ? errors[k] : null);

  // 状态变化通知多选：全部渠道 = null；开关开着但一个渠道都没勾 → 阻止保存
  const notifyError = form.notify === 1 && channels.length > 0
    && form.channelIds !== null && form.channelIds.length === 0
    ? "请至少勾选一个渠道，或勾选「全部渠道」"
    : null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(ALL_TOUCHED);
    if (blocked || notifyError) return;
    onSubmit();
  }

  return (
    <Drawer open={open} onClose={onClose} dirty={dirty}
      title={form.id ? "编辑监控" : "新建监控"}>
      <form onSubmit={submit} noValidate>
        <Group title="基本信息">
          <Field label="监控名" error={err("name")}>
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} invalid={!!err("name")}
                value={form.name} placeholder="如 生产环境网关" onBlur={touch("name")}
                onChange={e => set({ name: e.target.value })} />
            )}
          </Field>
          <Field label="探测地址" hint="默认携带浏览器 User-Agent 发起请求，模拟真实访问" error={err("url")}>
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} invalid={!!err("url")}
                value={form.url} placeholder="https://example.com/health" className="font-mono text-xs"
                onBlur={touch("url")} onChange={e => set({ url: e.target.value })} />
            )}
          </Field>
          <div className="mb-4">
            <Segmented
              label="请求方法"
              value={form.method}
              options={[{ value: "GET", label: "GET" }, { value: "HEAD", label: "HEAD" }]}
              onChange={method => set({ method })}
            />
            <p className="mt-1.5 text-xs text-fg-muted">HEAD 不读取响应体，更省流量；需要关键词检查时请用 GET。</p>
          </div>
          <Field label="期望状态码" hint="「任意 2xx」最常用；反代返回 401/302 的内网服务可指定具体码">
            {({ id }) => (
              <div className="flex gap-2">
                <Select id={id} className="w-40" value={form.expected_status === 0 ? "any" : "custom"}
                  onChange={e => set({ expected_status: e.target.value === "any" ? 0 : form.expected_status === 0 ? 200 : form.expected_status })}>
                  <option value="any">任意 2xx</option>
                  <option value="custom">指定状态码…</option>
                </Select>
                {form.expected_status !== 0 && (
                  <Input type="number" min={100} max={599} aria-label="期望状态码" className="w-28"
                    value={form.expected_status}
                    onChange={e => set({ expected_status: Number(e.target.value) || 0 })} />
                )}
              </div>
            )}
          </Field>
          <Field label="关键词（可选）" hint="响应体需包含该子串才算正常；留空不检查。仅 GET 生效">
            {({ id }) => (
              <Input id={id} value={form.keyword} placeholder={'如 "status":"ok"'} className="font-mono text-xs"
                onChange={e => set({ keyword: e.target.value })} />
            )}
          </Field>
        </Group>

        <Group title="探测设置">
          <div className="grid grid-cols-3 gap-3">
            <Field label="超时（秒）" error={err("timeout_sec")}>
              {({ id, describedBy }) => (
                <Input id={id} aria-describedby={describedBy} invalid={!!err("timeout_sec")}
                  type="number" min={1} max={30} value={form.timeout_sec} onBlur={touch("timeout_sec")}
                  onChange={e => set({ timeout_sec: Number(e.target.value) })} />
              )}
            </Field>
            <Field label="间隔（分钟）" hint="平台每 2 分钟唤醒" error={err("interval_min")}>
              {({ id, describedBy }) => (
                <Input id={id} aria-describedby={describedBy} invalid={!!err("interval_min")}
                  type="number" min={2} max={1440} value={form.interval_min} onBlur={touch("interval_min")}
                  onChange={e => set({ interval_min: Number(e.target.value) })} />
              )}
            </Field>
            <Field label="失败阈值" hint="连续失败 N 次才判定宕机，防止瞬时抖动误报" error={err("fail_threshold")}>
              {({ id, describedBy }) => (
                <Input id={id} aria-describedby={describedBy} invalid={!!err("fail_threshold")}
                  type="number" min={1} max={10} value={form.fail_threshold} onBlur={touch("fail_threshold")}
                  onChange={e => set({ fail_threshold: Number(e.target.value) })} />
              )}
            </Field>
          </div>
          <Field label="自定义请求头（可选）" hint="JSON 对象，同名头覆盖默认浏览器头" error={err("headers_json")}>
            {({ id, describedBy }) => (
              <Textarea id={id} aria-describedby={describedBy} invalid={!!err("headers_json")}
                rows={3} className="font-mono text-xs" value={form.headers_json}
                placeholder='{"Authorization": "Bearer xxx"}' onBlur={touch("headers_json")}
                onChange={e => set({ headers_json: e.target.value })} />
            )}
          </Field>
        </Group>

        <Group title="状态变化通知">
          <div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2.5">
              <span className="text-sm text-fg">宕机 / 恢复时推送</span>
              <Switch checked={form.notify === 1} label="状态变化通知"
                onChange={v => set({ notify: v ? 1 : 0 })} />
            </div>
            {form.notify === 1 && (channels.length > 0 ? (
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
                还没有通知渠道。到「账户 → 通知设置」添加后即可选择推送目标。
              </p>
            ))}
            {notifyError && <p role="alert" className="mt-2 text-xs text-danger">{notifyError}</p>}
          </div>
        </Group>

        <Group title="任务联动">
          <Field label="宕机时触发" hint="判定宕机的瞬间触发一次该任务（如自动重启 / 故障切换），不受任务启用状态限制">
            {({ id }) => (
              <Select id={id} value={form.on_down_job_id}
                onChange={e => set({ on_down_job_id: Number(e.target.value) })}>
                <option value={0}>不联动</option>
                {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="恢复时触发" hint="从宕机恢复的瞬间触发一次该任务（如恢复流量 / 发送善后通知）">
            {({ id }) => (
              <Select id={id} value={form.on_up_job_id}
                onChange={e => set({ on_up_job_id: Number(e.target.value) })}>
                <option value={0}>不联动</option>
                {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
              </Select>
            )}
          </Field>
          <p className="text-xs text-fg-subtle">
            联动触发会像手动触发一样记录运行并追踪执行结果；仅状态切换时触发一次，不会随每次失败重复触发。
          </p>
        </Group>

        <div className="sticky bottom-0 -mx-5 flex gap-2 border-t border-border bg-panel px-5 py-3">
          <Button type="submit" variant="primary" loading={busy} disabled={!form.url.trim()}>保存</Button>
          <Button type="button" variant="secondary" onClick={onClose}>取消</Button>
        </div>
      </form>
    </Drawer>
  );
}
