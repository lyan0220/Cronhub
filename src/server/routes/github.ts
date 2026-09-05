import { Hono } from "hono";
import { decryptText } from "../crypto";
import type { AccountRow, Env } from "../types";

const githubRoutes = new Hono<{ Bindings: Env }>();

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

const GH_HEADERS = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "cronjob-scheduler",
});

export type WorkflowItem = { id: string; name: string; path: string; state: string };

/**
 * 列出仓库可触发的 workflows（供任务表单下拉选择）。
 * 仓库里任意有 Actions 读权限的 PAT 都可调用；数字 ID 直接可用于 dispatches
 * 端点，比文件名更稳（子目录重名文件不会歧义）。
 */
githubRoutes.get("/workflows", async (c) => {
  const accountId = Number(c.req.query("account_id") ?? 0);
  const repo = (c.req.query("repo") ?? "").trim();
  if (!Number.isInteger(accountId) || accountId < 1 || !REPO_RE.test(repo)) {
    return c.json({ ok: false, error: "请先选择账号并填写 owner/repo" }, 400);
  }
  const account = await c.env.DB.prepare("SELECT * FROM accounts WHERE id=?")
    .bind(accountId)
    .first<AccountRow>();
  if (!account) return c.json({ ok: false, error: "账号不存在" }, 404);
  let token: string;
  try {
    token = await decryptText(account.token_encrypted, c.env.TOKEN_ENC_KEY);
  } catch {
    return c.json({ ok: false, error: "token 解密失败（TOKEN_ENC_KEY 是否变更？）" }, 500);
  }

  const res = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows?per_page=100`,
    { headers: GH_HEADERS(token), signal: AbortSignal.timeout(15_000) },
  ).catch(() => null);
  if (!res) return c.json({ ok: false, error: "请求 GitHub 失败，请稍后重试" }, 502);
  if (res.status === 404) return c.json({ ok: false, error: "仓库不存在，或 PAT 无权访问该仓库" }, 404);
  if (res.status === 403) return c.json({ ok: false, error: "PAT 缺少 Actions 读取权限（fine-grained 需勾选 Actions: Read）" }, 403);
  if (!res.ok) return c.json({ ok: false, error: `GitHub API ${res.status}` }, 502);

  const data = (await res.json()) as {
    workflows?: Array<{ id: number; name: string | null; path: string; state: string }>;
  };
  const workflows: WorkflowItem[] = (data.workflows ?? []).map((w) => ({
    id: String(w.id),
    name: w.name ?? "",
    path: w.path,
    state: w.state,
  }));
  return c.json({ ok: true, data: { workflows } });
});

export default githubRoutes;
