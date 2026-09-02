import { useState } from "react";
import { errText, put } from "../../api";
import { useToast } from "../../components/Toast";
import type { Account } from "../../types";
import { Badge, Button, Card, Field, Input, cx, iconActionDanger, iconActionInfo } from "../../ui";
import {
  CircleAlert, CircleCheck, CircleX, KeyRound, Pencil, RefreshCw, Trash2,
} from "../../ui/icons";
import { fmtTime } from "../../utils/time";

const STATUS = {
  ok: { tone: "success", label: "有效", Icon: CircleCheck },
  invalid: { tone: "danger", label: "失效", Icon: CircleX },
  unknown: { tone: "neutral", label: "未验证", Icon: CircleAlert },
} as const;

function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status as keyof typeof STATUS] ?? STATUS.unknown;
  return <Badge tone={s.tone} icon={<s.Icon className="size-3" aria-hidden />}>{s.label}</Badge>;
}

type Props = {
  account: Account;
  editing: boolean;
  verifying: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  /** 保存成功后通知父组件重拉列表并退出编辑态 */
  onSaved: () => void;
  onVerify: () => void;
  onRemove: () => void;
};

export default function AccountCard(p: Props) {
  if (p.editing) return <EditForm account={p.account} onCancel={p.onCancelEdit} onSaved={p.onSaved} />;

  const { account: a } = p;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium text-fg">{a.name}</div>
          <div className="truncate text-sm text-fg-muted">
            {a.github_login ? `@${a.github_login}` : "未验证登录名"}
          </div>
        </div>
        <StatusBadge status={a.status} />
      </div>

      <div className="space-y-1 text-xs">
        <div className="flex items-center gap-1.5 font-mono text-fg-muted">
          <KeyRound className="size-3.5 shrink-0" aria-hidden />
          {a.token_fingerprint}
        </div>
        <div className="text-fg-subtle">上次验证：{fmtTime(a.last_verified_at)}</div>
      </div>

      {/* 与任务卡片同一套动作排布：主操作文字按钮居左，编辑/删除图标按钮居右 */}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3">
        <Button size="sm" variant="secondary" loading={p.verifying} onClick={p.onVerify}
          icon={<RefreshCw className="size-3.5" />}>重新验证</Button>
        <div className="flex items-center gap-1">
          <button type="button" className={iconActionInfo} aria-label="编辑" title="编辑" onClick={p.onEdit}>
            <Pencil className="size-4" aria-hidden />
          </button>
          <button type="button" className={iconActionDanger} aria-label="删除" title="删除" onClick={p.onRemove}>
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    </Card>
  );
}

function EditForm({ account, onCancel, onSaved }:
  { account: Account; onCancel: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(account.name);
  const [token, setToken] = useState("");
  const [verify, setVerify] = useState(true);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      // token 留空表示不修改，因此这里是条件展开而非总是传
      await put(`/api/accounts/${account.id}`, { name, ...(token ? { token } : {}), verify });
      toast("账号已更新");
      onSaved();
    } catch (err) {
      toast(errText(err), "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}
      className="flex flex-col gap-3 rounded-xl border border-border bg-panel p-4 animate-in-pop">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Input value={name} aria-label="备注名" className="font-medium"
            onChange={e => setName(e.target.value)} />
        </div>
        <StatusBadge status={account.status} />
      </div>
      <div className="text-sm text-fg-muted">
        {account.github_login ? `@${account.github_login}` : "未验证登录名"}
      </div>
      <Field label="新 Token" hint="留空则不修改">
        {({ id, describedBy }) => (
          <Input id={id} aria-describedby={describedBy} type="password" value={token}
            placeholder="ghp_… / github_pat_…" onChange={e => setToken(e.target.value)} />
        )}
      </Field>
      {/* 后端的 PUT /api/accounts/:id 只在「带了新 token」的分支里读 verify，
          token 留空时勾不勾都不会发生任何事。所以这里跟着 token 一起禁用——
          界面不该承诺一件实际不会执行的操作。要单独复验现有 token，
          用卡片上的「验证」按钮（走 POST /api/accounts/:id/verify）。 */}
      <label className={cx(
        "flex items-center gap-2 text-xs text-fg-muted",
        !token && "opacity-50",
      )}>
        <input type="checkbox" checked={verify} disabled={!token} className="accent-fg cursor-pointer"
          onChange={e => setVerify(e.target.checked)} />
        保存新 Token 时在线验证（推荐）
      </label>
      <div className="mt-auto flex gap-2">
        <Button type="submit" size="sm" variant="primary" loading={busy}>保存</Button>
        <Button type="button" size="sm" variant="secondary" onClick={onCancel}>取消</Button>
      </div>
    </form>
  );
}
