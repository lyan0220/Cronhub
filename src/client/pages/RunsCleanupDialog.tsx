import { useEffect, useState } from "react";
import { errText, post, put } from "../api";
import { useToast } from "../components/Toast";
import { Button, Dialog, Field, Input, Select } from "../ui";
import { Trash2 } from "../ui/icons";

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

const RETENTION_OPTIONS = [30, 60, 90, 180, 365];

/** 运行记录清理：自动保留期配置 + 按天数/范围立即清理 */
export default function RunsCleanupDialog({ open, retentionDays, onClose, onRetentionChanged, onCleaned }: Props) {
  const toast = useToast();
  const [retention, setRetention] = useState(retentionDays);
  const [retentionBusy, setRetentionBusy] = useState(false);
  const [days, setDays] = useState(String(retentionDays));
  const [daysErr, setDaysErr] = useState("");
  const [failedOnly, setFailedOnly] = useState(false);
  const [busy, setBusy] = useState(false);

  // 每次打开都按父组件当前值重置，避免上次操作的残留
  useEffect(() => {
    if (open) {
      setRetention(retentionDays);
      setDays(String(retentionDays));
      setFailedOnly(false);
      setDaysErr("");
    }
  }, [open, retentionDays]);

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
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 3650) {
      setDaysErr("请输入 1-3650 的整数");
      return;
    }
    setDaysErr("");
    setBusy(true);
    try {
      const d = await post<{ deleted: number }>("/api/runs/cleanup", { days: n, failedOnly });
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
    <Dialog open={open} onClose={onClose} title="清理运行记录" width="max-w-sm"
      footer={<Button variant="secondary" onClick={onClose}>关闭</Button>}>
      {/* 自动清理：改的是调度器每 5 分钟使用的保留期（settings.runs_retention_days） */}
      <section className="mb-5">
        <p className="text-sm font-medium text-fg">自动清理</p>
        <p className="mt-0.5 text-xs text-fg-muted">调度器每 5 分钟运行一次，超过保留期的记录会被自动删除。</p>
        <div className="mt-2 flex items-center gap-2">
          <div className="w-36">
            <Select aria-label="自动清理保留期" value={retention}
              onChange={e => setRetention(Number(e.target.value))}>
              {RETENTION_OPTIONS.map(d => <option key={d} value={d}>{d} 天</option>)}
            </Select>
          </div>
          <Button size="sm" variant="secondary" loading={retentionBusy}
            disabled={retention === retentionDays}
            onClick={() => void saveRetention()}>保存</Button>
        </div>
      </section>

      <section>
        <p className="text-sm font-medium text-fg">立即清理</p>
        <p className="mt-0.5 text-xs text-fg-muted">删除指定天数之前的记录，立即执行、不影响保留期设置。</p>
        <div className="mt-2">
          <Field label="保留最近（天）" error={daysErr || null}>
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} type="number" min={1} max={3650}
                invalid={!!daysErr} value={days} onChange={e => setDays(e.target.value)} />
            )}
          </Field>
        </div>
        <label className="mt-3 mb-4 flex items-center gap-2 text-xs text-fg-muted">
          <input type="checkbox" checked={failedOnly} className="accent-fg cursor-pointer"
            onChange={e => setFailedOnly(e.target.checked)} />
          仅清理失败的记录
        </label>
        <Button variant="danger" loading={busy} onClick={() => void cleanNow()}
          icon={<Trash2 className="size-4" />}>立即清理</Button>
      </section>
    </Dialog>
  );
}
