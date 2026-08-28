import { Hono } from "hono";
import { encryptText, decryptText, tokenFingerprint } from "../crypto";
import { verifyGithubToken } from "../github";
import type { AccountRow, Env } from "../types";

const accountRoutes = new Hono<{ Bindings: Env }>();

type PublicAccount = Omit<AccountRow, "token_encrypted" | "created_at" | "updated_at">;

function publicView(a: AccountRow): PublicAccount {
  return {
    id: a.id,
    name: a.name,
    github_login: a.github_login,
    token_fingerprint: a.token_fingerprint,
    status: a.status,
    last_verified_at: a.last_verified_at,
  };
}

accountRoutes.get("/", async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM accounts ORDER BY id").all<AccountRow>();
  return c.json({ ok: true, data: (rows.results ?? []).map(publicView) });
});

accountRoutes.post("/", async (c) => {
  const body = await c.req.json<{ name?: unknown; token?: unknown; verify?: unknown }>().catch(() => ({}) as never);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!name || name.length > 100) return c.json({ ok: false, error: "备注名必填（≤100 字）" }, 400);
  if (token.length < 20) return c.json({ ok: false, error: "token 长度太短，请粘贴完整的 PAT" }, 400);

  let github_login: string | null = null;
  let status = "unknown";
  let last_verified_at: number | null = null;
  if (body.verify === true) {
    const v = await verifyGithubToken(token);
    if (!v.ok) return c.json({ ok: false, error: `Token 验证失败：${v.error}` }, 400);
    github_login = v.login;
    status = "ok";
    last_verified_at = Date.now();
  }

  const token_encrypted = await encryptText(token, c.env.TOKEN_ENC_KEY);
  const now = Date.now();
  const r = await c.env.DB.prepare(
    "INSERT INTO accounts (name, github_login, token_encrypted, token_fingerprint, status, last_verified_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
  )
    .bind(name, github_login, token_encrypted, tokenFingerprint(token), status, last_verified_at, now, now)
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM accounts WHERE id=?").bind(r.meta.last_row_id).first<AccountRow>();
  return c.json({ ok: true, data: row ? publicView(row) : null }, 201);
});

accountRoutes.post("/:id/verify", async (c) => {
  const account = await c.env.DB.prepare("SELECT * FROM accounts WHERE id=?").bind(Number(c.req.param("id"))).first<AccountRow>();
  if (!account) return c.json({ ok: false, error: "账号不存在" }, 404);
  const token = await decryptText(account.token_encrypted, c.env.TOKEN_ENC_KEY).catch(() => "");
  if (!token) return c.json({ ok: false, error: "token 解密失败" }, 500);
  const v = await verifyGithubToken(token);
  const status = v.ok ? "ok" : "invalid";
  const now = Date.now();
  await c.env.DB.prepare(
    "UPDATE accounts SET github_login=?, status=?, last_verified_at=?, updated_at=? WHERE id=?",
  )
    .bind(v.ok ? v.login : account.github_login, status, now, now, account.id)
    .run();
  if (!v.ok) return c.json({ ok: false, error: `Token 验证失败：${v.error}` }, 400);
  return c.json({ ok: true, data: { status, github_login: v.login } });
});

accountRoutes.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const account = await c.env.DB.prepare("SELECT * FROM accounts WHERE id=?").bind(id).first<AccountRow>();
  if (!account) return c.json({ ok: false, error: "账号不存在" }, 404);
  const body = await c.req.json<{ name?: unknown; token?: unknown; verify?: unknown }>().catch(() => ({}) as never);

  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : account.name;
  if (name.length > 100) return c.json({ ok: false, error: "备注名必填（≤100 字）" }, 400);
  const newToken = typeof body.token === "string" && body.token.trim() ? body.token.trim() : null;
  if (newToken && newToken.length < 20) return c.json({ ok: false, error: "token 长度太短" }, 400);

  const now = Date.now();
  if (newToken) {
    const token_encrypted = await encryptText(newToken, c.env.TOKEN_ENC_KEY);
    await c.env.DB.prepare(
      "UPDATE accounts SET name=?, token_encrypted=?, token_fingerprint=?, updated_at=? WHERE id=?",
    )
      .bind(name, token_encrypted, tokenFingerprint(newToken), now, id)
      .run();
    if (body.verify === true) {
      const v = await verifyGithubToken(newToken);
      await c.env.DB.prepare(
        "UPDATE accounts SET github_login=?, status=?, last_verified_at=?, updated_at=? WHERE id=?",
      ).bind(v.ok ? v.login : null, v.ok ? "ok" : "invalid", now, now, id).run();
    }
  } else {
    await c.env.DB.prepare("UPDATE accounts SET name=?, updated_at=? WHERE id=?").bind(name, now, id).run();
  }
  const row = await c.env.DB.prepare("SELECT * FROM accounts WHERE id=?").bind(id).first<AccountRow>();
  return c.json({ ok: true, data: row ? publicView(row) : null });
});

accountRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  await c.env.DB.prepare("DELETE FROM runs WHERE job_id IN (SELECT id FROM jobs WHERE account_id=?)").bind(id).run();
  await c.env.DB.prepare("DELETE FROM jobs WHERE account_id=?").bind(id).run();
  await c.env.DB.prepare("DELETE FROM accounts WHERE id=?").bind(id).run();
  return c.json({ ok: true, data: null });
});

export default accountRoutes;
