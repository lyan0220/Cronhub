import { useEffect, useState } from "react";
import { errText, get } from "../../api";
import type { Schedule } from "../../types";
import { Input, Segmented, Select, cx } from "../../ui";
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

// number 输入的原生步进箭头既占宽度又与整体风格不符，隐藏之（键盘上下键仍可步进）
const noSpin = "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

/** 连体输入组内的竖分隔线：一根发丝线把几个裸控件接成「一个」控件 */
function Divider() {
  return <div aria-hidden className="w-px shrink-0 bg-border" />;
}

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
        setErr(errText(e));
        onError(errText(e));
      }
    }, 400); // 防抖
    return () => clearTimeout(t);
    // 依赖只写 key。onError 是父组件每次渲染新建的内联函数，
    // 加进依赖会让防抖计时器被反复重建，等效于取消防抖。
  }, [key]);

  return (
    <div>
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
        <Input aria-label="cron 表达式" className="font-mono" value={value.expr ?? ""} invalid={!!err}
          placeholder="分 时 日 月 周（UTC），如 30 3 * * *"
          onChange={e => onChange({ ...value, expr: e.target.value })} />
      ) : (
        // 连体输入组：外层只画一圈边框和一份 focus-within 强调，内部是裸控件 +
        // 发丝分隔线。三个独立描边控件并排的割裂感来自「三圈边框」，合并后视觉上
        // 是一个控件。
        <div className={cx(
          "flex items-stretch overflow-hidden rounded-lg border border-border bg-panel",
          "transition-colors duration-fast ease-smooth",
          "focus-within:border-fg/60 focus-within:ring-2 focus-within:ring-fg/12",
        )}>
          <div className="w-28 shrink-0">
            <Select bare aria-label="间隔模式" value={value.mode ?? "fixed"}
              onChange={e => onChange({
                ...value,
                mode: e.target.value as "fixed" | "random",
                ...(e.target.value === "random" ? { min: 30, max: 90 } : { value: 45 }),
              })}>
              <option value="fixed">固定间隔</option>
              <option value="random">随机间隔</option>
            </Select>
          </div>
          <Divider />
          {value.mode === "random" ? (
            <>
              {/* 数字框 flex-1：宽度跟着行走，4 位数也不会被截断 */}
              <div className="min-w-0 flex-1">
                <Input bare type="number" min={1} aria-label="最小间隔" className={cx("text-center", noSpin)}
                  value={value.min ?? 30}
                  onChange={e => onChange({ ...value, min: Number(e.target.value) })} />
              </div>
              <span aria-hidden className="shrink-0 self-center px-0.5 text-fg-subtle">~</span>
              <div className="min-w-0 flex-1">
                <Input bare type="number" min={1} aria-label="最大间隔" className={cx("text-center", noSpin)}
                  value={value.max ?? 90}
                  onChange={e => onChange({ ...value, max: Number(e.target.value) })} />
              </div>
            </>
          ) : (
            <div className="min-w-0 flex-1">
              <Input bare type="number" min={1} aria-label="间隔数值" className={cx("text-center", noSpin)}
                value={value.value ?? 45}
                onChange={e => onChange({ ...value, value: Number(e.target.value) })} />
            </div>
          )}
          <Divider />
          <div className="w-24 shrink-0">
            <Select bare aria-label="间隔单位" value={value.unit ?? "m"}
              onChange={e => onChange({ ...value, unit: e.target.value as "m" | "h" | "d" })}>
              <option value="m">分钟</option>
              <option value="h">小时</option>
              <option value="d">天</option>
            </Select>
          </div>
        </div>
      )}

      {/* 预览做成内嵌的「读数」面板：比控件低一级的面貌，把排布收拢成
          「选择 → 输入 → 读数」三段 */}
      <div className="mt-3 rounded-lg bg-surface px-3 py-2.5 text-xs">
        {err ? (
          <p role="alert" className="text-danger">{err}</p>
        ) : (
          <div className="text-fg-muted">
            <p className="mb-1.5">未来触发时间</p>
            <ul className="space-y-1">
              {preview.map(p => (
                <li key={p.ms} className="flex items-baseline justify-between gap-3 font-mono tabular-nums">
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
