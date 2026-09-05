import { useEffect, useId, useState } from "react";
import { errText, post, put } from "../api";
import { useToast } from "../components/Toast";
import { Button, Dialog, Input, Select } from "../ui";

type Props = {
  open: boolean;
  /** 当前生效的自动清理保留期（天） */
  retentionDays: number;
  onClose: () => void;
  /** 保留期保存成功后同步父组件（页面描述文案用） */
  onRetentionChanged: (days: number) => void;
  /** 立即清理成功后父组件刷新列表 */
  onCleaned: () => void;
};

const DAY = 24 * 3600 * 1000;

const fmtCutoff = (ms: number) =>
  new Date(ms).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });

/**
 * 运行记录清理。「自动清理」「立即清理」各是一个独立表单：标题、字段行
 * （字段名 + 天数控件 + 单位「天」）、说明、全宽动作按钮依次向下。
 * 两个表单互不影响：自动的保留期和立即的天数各自设置。
 */
export default function RunsCleanupDialog({ open, retentionDays, onClose, onRetentionChanged, onCleaned }: Props) {
  const toast = useToast();
  const [retention, setRetention] = useState(retentionDays); // 自动清理的保留期
  const [days, setDays] = useState(String(retentionDays)); // 立即清理的保留天数（自由输入）
  const [daysErr, setDaysErr] = useState("");
  const [retentionBusy, setRetentionBusy] = useState(false);
  const [failedOnly, setFailedOnly] = useState(false);
  const [busy, setBusy] = useState(false);

  const id = useId();
  const retentionId = `${id}-retention`;
  const daysId = `${id}-days`;
  const daysErrId = `${id}-days-err`;

  const parsed = Number(days);
  const daysValid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 3650;

  // 每次打开都按父组件当前值重置，避免上次操作的残留
  useEffect(() => {
    if (open) {
      setRetention(retentionDays);
      setDays(String(retentionDays));
      setDaysErr("");
      setFailedOnly(false);
    }
  }, [open, retentionDays]);

  // 库里可能存了预设之外的天数（比如手改过的 45），并进选项避免 select 空显示
  const dayOptions = [7, 14, 30, 60, 90, 180, 365];
  const retentionOptions = dayOptions.includes(retention)
    ? dayOptions
    : [...dayOptions, retention].sort((a, b) => a - b);

  function onDaysChange(v: string) {
    setDays(v);
    const n = Number(v);
    setDaysErr(v !== "" && !(Number.isInteger(n) && n >= 1 && n <= 3650) ? "请输入 1-3650 的整数" : "");
  }

  async function saveRetention() {
    setRetentionBusy(true);
    try {
      await put("/api/runs/retention", { days: retention });
      toast("自动清理保留期已更新");
      onRetentionChanged(retention);
    } catch (e) {
      toast(errText(e), "err");
    } finally {
      setRetentionBusy(false);
    }
  }

  async function cleanNow() {
    if (!daysValid) {
      setDaysErr("请输入 1-3650 的整数");
      return;
    }
    setBusy(true);
    try {
      const d = await post<{ deleted: number }>("/api/runs/cleanup", { days: parsed, failedOnly });
      toast(`已清理 ${d.deleted} 条记录`);
      onClose();
      onCleaned();
    } catch (e) {
      toast(errText(e), "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="清理运行记录" width="max-w-sm">
      {/* 表单一：自动清理 */}
      <section>
        <h3 className="text-sm font-semibold text-fg">自动清理</h3>
        <div className="mt-2.5 flex items-center gap-2">
          <label htmlFor={retentionId} className="shrink-0 text-sm text-fg-muted">保留最近</label>
          <div className="w-24 shrink-0">
            <Select id={retentionId} value={retention}
              onChange={e => setRetention(Number(e.target.value))}>
              {retentionOptions.map(d => <option key={d} value={d}>{d}</option>)}
            </Select>
          </div>
          <span className="text-sm text-fg-muted">天</span>
        </div>
        <p className="mt-2 text-xs text-fg-muted">超过保留期的记录由调度器自动删除。</p>
        <Button className="mt-3 w-full" loading={retentionBusy} disabled={retention === retentionDays}
          variant={retention === retentionDays ? "secondary" : "primary"}
          onClick={() => void saveRetention()}>保存</Button>
      </section>
      

      {/* 表单二：立即清理 */}
      <section className="mt-6">
        <h3 className="text-sm font-semibold text-fg">立即清理</h3>
        <div className="mt-2.5 flex items-center gap-2">
          <label htmlFor={daysId} className="shrink-0 text-sm text-fg-muted">保留最近</label>
          <div className="w-24 shrink-0">
            <Input id={daysId} aria-describedby={daysErr ? daysErrId : undefined}
              type="number" min={1} max={3650} invalid={!!daysErr} value={days}
              onChange={e => onDaysChange(e.target.value)} />
          </div>
          <span className="text-sm text-fg-muted">天</span>
        </div>
        <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-sm text-fg-muted">
          <input type="checkbox" checked={failedOnly} className="accent-fg cursor-pointer"
            onChange={e => setFailedOnly(e.target.checked)} />
          仅清理失败记录
        </label>
        {daysValid ? (
          <p className="mt-2 text-xs text-fg-muted">
            将删除 <span className="font-medium text-fg tnum">{fmtCutoff(Date.now() - parsed * DAY)}</span>{" "}
            之前的{failedOnly ? "失败" : "全部"}记录，删除后无法恢复。
          </p>
        ) : daysErr ? (
          <p id={daysErrId} role="alert" className="mt-2 text-xs text-danger">{daysErr}</p>
        ) : null}
        <Button variant="danger" className="mt-3 w-full" loading={busy} disabled={!daysValid}
          onClick={() => void cleanNow()}>立即清理</Button>
      </section>
    </Dialog>
  );
}
