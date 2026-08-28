import { useEffect, useState } from "react";
import { del, fmtTime, get, post, put } from "../api";
import { useToast } from "../components/Toast";
import type { Account } from "../types";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    ok: ["bg-emerald-100 text-emerald-700", "有效"],
    invalid: ["bg-red-100 text-red-700", "失效"],
    unknown: ["bg-neutral-100 text-neutral-500", "未验证"],
  };
  const [cls, label] = map[status] ?? map.unknown;
  return <span className={`rounded-full px-2 py-0.5 text-xs ${cls}`}>{label}</span>;
}

// 卡片内编辑表单：备注名预填，token 留空表示不修改
function EditForm({ account, onDone }: { account: Account; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(account.name);
  const [token, setToken] = useState("");
  const [verify, setVerify] = useState(true);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await put(`/api/accounts/${account.id}`, {
        name,
        ...(token ? { token } : {}),
        verify,
      });
      toast("账号已更新");
      onDone();
    } catch (err) {
      toast((err as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="border-t border-neutral-200 pt-3 dark:border-neutral-800">
      <label className="mb-1 block text-xs">备注名</label>
      <input value={name} onChange={e => setName(e.target.value)}
        className="mb-3 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800" />
      <label className="mb-1 block text-xs">Personal Access Token</label>
      <input value={token} onChange={e => setToken(e.target.value)} placeholder="留空则不修改 Token" type="password"
        className="mb-3 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800" />
      <label className="mb-3 flex items-center gap-2 text-xs">
        <input type="checkbox" checked={verify} onChange={e => setVerify(e.target.checked)} />
        保存时在线验证 Token（推荐）
      </label>
      <div className="flex gap-2">
        <button disabled={busy} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-500 disabled:opacity-50">
          {busy ? "保存中…" : "保存"}
        </button>
        <button type="button" onClick={onDone} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
          取消
        </button>
      </div>
    </form>
  );
}

export default function Accounts() {
  const toast = useToast();
  const [list, setList] = useState<Account[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [verify, setVerify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  async function load() {
    setList(await get<Account[]>("/api/accounts"));
  }
  useEffect(() => { load(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await post("/api/accounts", { name, token, verify });
      toast("账号已添加");
      setShowForm(false); setName(""); setToken("");
      await load();
    } catch (err) {
      toast((err as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }

  async function reVerify(a: Account) {
    try {
      await post(`/api/accounts/${a.id}/verify`);
      toast(`验证通过：${a.name}`);
      await load();
    } catch (err) {
      toast((err as Error).message, "err");
      await load();
    }
  }

  async function remove(a: Account) {
    if (!confirm(`删除账号「${a.name}」？其下所有任务与运行记录会一并删除。`)) return;
    await del(`/api/accounts/${a.id}`);
    toast("已删除");
    await load();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">GitHub 账号</h1>
        <button onClick={() => setShowForm(v => !v)} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-500">
          {showForm ? "取消" : "+ 添加账号"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={submit} className="mb-6 max-w-xl rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <label className="mb-1 block text-sm">备注名</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="如：主账号"
            className="mb-3 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800" />
          <label className="mb-1 block text-sm">Personal Access Token</label>
          <input value={token} onChange={e => setToken(e.target.value)} placeholder="ghp_… / github_pat_…" type="password"
            className="mb-3 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800" />
          <label className="mb-4 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={verify} onChange={e => setVerify(e.target.checked)} />
            保存时在线验证 Token（推荐）
          </label>
          <button disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-500 disabled:opacity-50">
            {busy ? "保存中…" : "保存"}
          </button>
          <p className="mt-3 text-xs text-neutral-500">Token 加密存储，保存后不再显示明文。建议使用最小权限的 Fine-grained PAT。</p>
        </form>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.map(a => (
          <div key={a.id} className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="mb-2 flex items-start justify-between">
              <div>
                <div className="font-medium">{a.name}</div>
                <div className="text-sm text-neutral-500">{a.github_login ? `@${a.github_login}` : "未验证登录名"}</div>
              </div>
              <StatusBadge status={a.status} />
            </div>
            <div className="mb-1 font-mono text-sm text-neutral-500">{a.token_fingerprint}</div>
            <div className="mb-3 text-xs text-neutral-400">上次验证：{fmtTime(a.last_verified_at)}</div>
            {editingId === a.id ? (
              <EditForm account={a} onDone={async () => { setEditingId(null); await load(); }} />
            ) : (
              <div className="flex gap-2">
                <button onClick={() => reVerify(a)} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">重新验证</button>
                <button onClick={() => setEditingId(a.id)} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">编辑</button>
                <button onClick={() => remove(a)} className="rounded-lg border border-red-300 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950">删除</button>
              </div>
            )}
          </div>
        ))}
        {list.length === 0 && <div className="text-sm text-neutral-500">还没有账号，点击右上角添加。</div>}
      </div>
    </div>
  );
}
