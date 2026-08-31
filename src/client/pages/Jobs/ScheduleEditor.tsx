import { useEffect, useState } from "react";
import { get } from "../../api";
import type { Schedule } from "../../types";
import { Input, Segmented, Select } from "../../ui";
import { fmtTime, relativeTime } from "../../utils/time";
import { EMPTY_SCHEDULE } from "./schedule";

type Props = {
  value: Schedule;
  onChange: (s: Schedule) => void;
  /** 把 /api/cron/preview 的报错上报给表单，用于禁用保存按钮 */
  onError: (msg: string | null) => void;
};

const TABS: { type: Schedule["type"]; label: string }[] = [
  { type: "interval", label: "间隔" },
  { type: "cron", label: "cron 表达式" },
];

export default function ScheduleEditor({ value, onChange, onError }: Props) {
  const [preview, setPreview] = useState<{ ms: number; text: string }[]>([]);
  const [err, setErr] = useState("");

  const key = JSON.stringify(value);
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const data = await get<{ times: number[] }>(
          `/api/cron/preview?rule=${encodeURIComponent(key)}`,
        );
        setPreview(data.times.map(ms => ({ ms, text: fmtTime(ms) })));
        setErr("");
        onError(null);
      } catch (e) {
        setPreview([]);
        setErr((e as Error).message);
        onError((e as Error).message);
      }
    }, 400); // 防抖
    return () => clearTimeout(t);
    // 依赖只写 key。onError 是父组件每次渲染新建的内联函数，
    // 加进依赖会让防抖计时器被反复重建，等效于取消防抖。
  }, [key]);

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-3">
        <Segmented
          label="调度类型"
          value={value.type}
          options={TABS.map(t => ({ value: t.type, label: t.label }))}
          onChange={type => onChange(
            type === "cron" ? { type: "cron", expr: "30 3 * * *" } : EMPTY_SCHEDULE,
          )}
        />
      </div>

      {value.type === "cron" ? (
        <Input value={value.expr ?? ""} invalid={!!err}
          placeholder="分 时 日 月 周（UTC），如 30 3 * * *"
          onChange={e => onChange({ ...value, expr: e.target.value })} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-32">
            <Select value={value.mode ?? "fixed"}
              onChange={e => onChange({
                ...value,
                mode: e.target.value as "fixed" | "random",
                ...(e.target.value === "random" ? { min: 30, max: 90 } : { value: 45 }),
              })}>
              <option value="fixed">固定间隔</option>
              <option value="random">随机间隔</option>
            </Select>
          </div>
          {value.mode === "random" ? (
            <>
              <div className="w-24">
                <Input type="number" min={1} value={value.min ?? 30}
                  onChange={e => onChange({ ...value, min: Number(e.target.value) })} />
              </div>
              <span className="text-fg-muted">~</span>
              <div className="w-24">
                <Input type="number" min={1} value={value.max ?? 90}
                  onChange={e => onChange({ ...value, max: Number(e.target.value) })} />
              </div>
            </>
          ) : (
            <div className="w-24">
              <Input type="number" min={1} value={value.value ?? 45}
                onChange={e => onChange({ ...value, value: Number(e.target.value) })} />
            </div>
          )}
          <div className="w-24">
            <Select value={value.unit ?? "m"}
              onChange={e => onChange({ ...value, unit: e.target.value as "m" | "h" | "d" })}>
              <option value="m">分钟</option>
              <option value="h">小时</option>
              <option value="d">天</option>
            </Select>
          </div>
        </div>
      )}

      <div className="mt-3 text-xs">
        {err ? (
          <p role="alert" className="text-danger">{err}</p>
        ) : (
          <div className="text-fg-muted">
            <p className="mb-1">未来触发时间</p>
            <ul className="space-y-0.5">
              {preview.map(p => (
                <li key={p.ms} className="flex gap-2 font-mono tabular-nums">
                  <span className="text-fg">{p.text}</span>
                  <span className="text-fg-subtle">{relativeTime(p.ms)}</span>
                </li>
              ))}
            </ul>
            {value.type === "cron" && (
              <p className="mt-2">支持 <code>*</code>、<code>*/n</code>、<code>a-b</code>、逗号列表。按 UTC 计算。</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
