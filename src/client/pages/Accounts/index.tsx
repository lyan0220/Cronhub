import { useEffect, useState } from "react";
import { del, errText, get, post } from "../../api";
import PageHeader from "../../components/PageHeader";
import { useToast } from "../../components/Toast";
import type { Account } from "../../types";
import { Button, EmptyState, Field, Input, SkeletonCard, useConfirm } from "../../ui";
import { KeyRound, Plus, X } from "../../ui/icons";
import AccountCard from "./AccountCard";
import { useAlive } from "../../utils/useAlive";

export default function Accounts() {
  const toast = useToast();
  const confirm = useConfirm();
  const [list, setList] = useState<Account[] | null>(null); // null = 首屏加载中
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [verify, setVerify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [verifyingId, setVerifyingId] = useState<number | null>(null);
  const alive = useAlive();

  async function load() {
    const list = await get<Account[]>("/api/accounts");
    if (alive.current) setList(list);
  }
  useEffect(() => { load().catch(e => toast(errText(e), "err")); }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await post("/api/accounts", { name, token, verify });
      toast("账号已添加");
      setAdding(false); setName(""); setToken("");
      await load();
    } catch (err) {
      toast(errText(err), "err");
    } finally {
      setBusy(false);
    }
  }

  async function reVerify(a: Account) {
    setVerifyingId(a.id);
    try {
      await post(`/api/accounts/${a.id}/verify`);
      toast(`验证通过：${a.name}`);
    } catch (err) {
      toast(errText(err), "err");
    } finally {
      setVerifyingId(null);
      // 成败都重拉：验证失败时服务端会把 status 置为 invalid，卡片徽章要跟着变。
      await load().catch(() => {});
    }
  }

  async function remove(a: Account) {
    const ok = await confirm({
      title: `删除账号「${a.name}」？`,
      description: "该账号下的所有任务与运行记录会一并删除，且无法恢复。",
      confirmText: "删除",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await del(`/api/accounts/${a.id}`);
      toast("已删除");
      await load();
    } catch (err) {
      toast(errText(err), "err");
    }
  }

  return (
    <div>
      <PageHeader
        title="GitHub 账号"
        description="Token 加密存储，仅用于触发 Actions。"
        action={
          <Button variant={adding ? "secondary" : "primary"} onClick={() => setAdding(v => !v)}
            icon={adding ? <X className="size-4" /> : <Plus className="size-4" />}>
            {adding ? "取消" : "添加账号"}
          </Button>
        }
      />

      {adding && (
        <form onSubmit={add}
          className="animate-in-pop mb-6 max-w-xl rounded-xl border border-border bg-panel p-4">
          <Field label="备注名">
            {({ id }) => (
              <Input id={id} value={name} placeholder="如：主账号"
                onChange={e => setName(e.target.value)} />
            )}
          </Field>
          <Field label="Personal Access Token" hint="加密存储，保存后不再显示明文；建议用最小权限的 Fine-grained PAT">
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} type="password" value={token}
                placeholder="ghp_… / github_pat_…" onChange={e => setToken(e.target.value)} />
            )}
          </Field>
          <label className="mb-4 flex items-center gap-2 text-sm text-fg-muted">
            <input type="checkbox" checked={verify} className="accent-fg cursor-pointer"
              onChange={e => setVerify(e.target.checked)} />
            保存时在线验证 Token（推荐）
          </label>
          <Button type="submit" variant="primary" loading={busy}
            disabled={!name.trim() || !token.trim()}>保存</Button>
        </form>
      )}

      {list === null ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map(i => <SkeletonCard key={i} />)}
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={<KeyRound className="size-6" />}
          title="还没有账号"
          description="添加一个 GitHub Token，任务才能触发 Actions。"
          action={
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
              添加账号
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map(a => (
            <AccountCard
              key={a.id}
              account={a}
              editing={editingId === a.id}
              verifying={verifyingId === a.id}
              onEdit={() => setEditingId(a.id)}
              onCancelEdit={() => setEditingId(null)}
              onSaved={async () => { setEditingId(null); await load(); }}
              onVerify={() => void reVerify(a)}
              onRemove={() => void remove(a)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
