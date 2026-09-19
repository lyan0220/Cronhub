import { useState, type ReactNode } from "react";
import { LOCAL_TZ, timezoneOptions } from "../Jobs/schedule";
import { CHANNEL_TYPE_LABEL, type Channel, type Job } from "../../types";
import { Badge, Button, Checkbox, Drawer, Field, Input, Segmented, Select, Switch, Textarea } from "../../ui";

export type MonitorFormData = {
  id?: number;
  name: string;
  url: string;
  method: "GET" | "HEAD";
  /** 逗号分隔的单码或区间（"200-299" / "200,204"），默认 "200-299" */
  expected_status: string;
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
  /** 暂停时段（HH:MM），"" = 不暂停 */
  pause_start: string;
  pause_end: string;
  /** 暂停时段生效时区（IANA 名称） */
  timezone: string;
};

export const EMPTY_FORM: MonitorFormData = {
  name: "", url: "", method: "GET", expected_status: "200-299", keyword: "",
  headers_json: "", timeout_sec: 10, interval_min: 5, fail_threshold: 1,
  notify: 0, channelIds: null, on_down_job_id: 0, on_up_job_id: 0,
  pause_start: "", pause_end: "", timezone: LOCAL_TZ,
};

type Key = "name" | "url" | "timeout_sec" | "interval_min" | "fail_threshold" | "headers_json" | "expected_status" | "pause";

const ALL_TOUCHED: Record<Key, boolean> = {
  name: true, url: true, timeout_sec: true,
  interval_min: true, fail_threshold: true, headers_json: true, expected_status: true,
  pause: true,
};

/** 暂停时段的可选时刻（30 分钟粒度） */
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, "0");
  return `${h}:${i % 2 ? "30" : "00"}`;
});

/** 校验状态码输入：逗号分隔的单码或区间，与服务端规则一致 */
function validateCodes(v: string): string | null {
  const tokens = v.trim().split(",").map(t => t.trim()).filter(Boolean);
  if (tokens.length === 0) return null; // 留空 = 默认 200-299
  if (tokens.length > 10) return "状态码最多 10 个";
  for (const t of tokens) {
    if (/^\d{3}$/.test(t)) {
      const n = Number(t);
      if (n < 100 || n > 599) return "状态码应为 100-599 的整数";
      continue;
    }
    const m = /^(\d{3})-(\d{3})$/.exec(t);
    if (m) {
      const a = Number(m[1]), b = Number(m[2]);
      if (a > b || a < 100 || b > 599) return "区间格式应为 200-299（起点 ≤ 终点）";
      continue;
    }
    return "格式如 200 或 200-299，多个用英文逗号分隔";
  }
  return null;
}

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
    expected_status: validateCodes(f.expected_status),
    // Select 只产出合法 HH:MM 或空值，这里只校验配对与零长
    pause: (f.pause_start || f.pause_end) && (!f.pause_start || !f.pause_end)
      ? "开始与结束需同时设置"
      : f.pause_start && f.pause_start === f.pause_end ? "起止时间相同" : null,
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
          <Field label="期望状态码" hint="默认 200-299（任意 2xx）；支持多个或区间，如 200,204、301-302。反代 401/302 的内网服务可填具体码"
            error={err("expected_status")}>
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} invalid={!!err("expected_status")}
                value={form.expected_status} placeholder="200" className="font-mono w-40" onBlur={touch("expected_status")}
                onChange={e => set({ expected_status: e.target.value })} />
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
            <Field label="失败阈值" hint="连续失败 N 次才判定离线，防止瞬时抖动误报" error={err("fail_threshold")}>
              {({ id, describedBy }) => (
                <Input id={id} aria-describedby={describedBy} invalid={!!err("fail_threshold")}
                  type="number" min={1} max={10} value={form.fail_threshold} onBlur={touch("fail_threshold")}
                  onChange={e => set({ fail_threshold: Number(e.target.value) })} />
              )}
            </Field>
          </div>
          <Field label="暂停时段（可选）" hint="窗口内跳过探测，不产生心跳与告警；支持跨天（如 22:00 至 06:00）" error={err("pause")}>
            {({ id }) => (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Select id={id} className="w-28" value={form.pause_start}
                    onChange={e => set({ pause_start: e.target.value })}>
                    <option value="">不暂停</option>
                    {TIME_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </Select>
                  <span className="text-xs text-fg-subtle">至</span>
                  <Select className="w-28" aria-label="暂停结束时间" value={form.pause_end}
                    onChange={e => set({ pause_end: e.target.value })}>
                    <option value="">不暂停</option>
                    {TIME_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </Select>
                  <span className="ml-auto text-xs text-fg-subtle">时区</span>
                  <Select className="w-48" aria-label="暂停时段时区" value={form.timezone}
                    onChange={e => set({ timezone: e.target.value })}>
                    {timezoneOptions().map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                </div>
              </div>
            )}
          </Field>
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
              <span className="text-sm text-fg">离线 / 恢复时推送</span>
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
          <Field label="离线时触发" hint="判定离线的瞬间触发一次该任务（如自动重启 / 故障切换），不受任务启用状态限制">
            {({ id }) => (
              <Select id={id} value={form.on_down_job_id}
                onChange={e => set({ on_down_job_id: Number(e.target.value) })}>
                <option value={0}>不联动</option>
                {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="恢复时触发" hint="从离线恢复的瞬间触发一次该任务（如恢复流量 / 发送善后通知）">
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
