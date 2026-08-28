import { describe, it, expect, beforeEach, vi } from "vitest";
import accountRoutes from "../src/server/routes/accounts";
import { encryptText } from "../src/server/crypto";
import { FakeD1 } from "./helpers/fake-d1";
import type { Env } from "../src/server/types";

let db: FakeD1;
let env: Env;
beforeEach(async () => {
  db = new FakeD1();
  env = { DB: db as unknown as D1Database, ASSETS: null as never, ADMIN_PASSWORD: "pw", TOKEN_ENC_KEY: "enckey" };
  db.accounts.push({
    id: 1, name: "旧账号", github_login: "alice",
    token_encrypted: await encryptText("ghp_existing_token_xxxx", "enckey"),
    token_fingerprint: "****xxxx", status: "ok", last_verified_at: 1,
    created_at: 1, updated_at: 1,
  });
});

function req(path: string, init?: RequestInit) {
  return accountRoutes.request(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers as Record<string, string>) },
  }, env);
}

describe("账号路由", () => {
  it("列表不泄露 token", async () => {
    const res = await req("/");
    const json = (await res.json()) as { ok: boolean; data: unknown[] };
    expect(json.ok).toBe(true);
    expect(JSON.stringify(json.data)).not.toContain("ghp_");
    expect(json.data[0]).toMatchObject({ id: 1, name: "旧账号", token_fingerprint: "****xxxx" });
  });

  it("新增账号并验证成功", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ login: "bob" }), { status: 200 })));
    const res = await req("/", { method: "POST", body: JSON.stringify({ name: "新账号", token: "ghp_new_token_1234567890", verify: true }) });
    const json = (await res.json()) as { data: Record<string, unknown> };
    expect(res.status).toBe(201);
    expect(json.data).toMatchObject({ name: "新账号", github_login: "bob", status: "ok" });
    expect(db.accounts[1].token_encrypted).not.toContain("ghp_new");
    vi.unstubAllGlobals();
  });

  it("验证失败时拒绝保存", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));
    const res = await req("/", { method: "POST", body: JSON.stringify({ name: "x", token: "ghp_bad_token_1234567890", verify: true }) });
    expect(res.status).toBe(400);
    expect(db.accounts).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it("token 太短拒绝", async () => {
    const res = await req("/", { method: "POST", body: JSON.stringify({ name: "x", token: "short" }) });
    expect(res.status).toBe(400);
  });

  it("重新验证解密存量 token 并更新状态", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ login: "alice2" }), { status: 200 })));
    const res = await req("/1/verify", { method: "POST" });
    const json = (await res.json()) as { data: { status: string } };
    expect(json.data.status).toBe("ok");
    expect(db.accounts[0].github_login).toBe("alice2");
    vi.unstubAllGlobals();
  });

  it("更新名称与换 token", async () => {
    const res = await req("/1", { method: "PUT", body: JSON.stringify({ name: "改名" }) });
    expect(db.accounts[0].name).toBe("改名");
    await req("/1", { method: "PUT", body: JSON.stringify({ token: "ghp_replaced_token_abcdefgh" }) });
    expect(db.accounts[0].token_fingerprint).toBe("****efgh");
    expect(db.accounts[0].token_encrypted).not.toContain("ghp_replaced");
  });

  it("更新名称超长被拒绝", async () => {
    const res = await req("/1", { method: "PUT", body: JSON.stringify({ name: "长".repeat(101) }) });
    expect(res.status).toBe(400);
  });

  it("删除账号级联删除任务与运行记录", async () => {
    db.jobs.push({ id: 7, name: "j", account_id: 1, repo: "a/b", trigger_type: "workflow_dispatch", workflow_id: "x.yml", event_type: null, ref: "main", inputs_json: null, schedule_json: "{}", enabled: 1, next_run_at: 0, last_run_at: null, created_at: 0, updated_at: 0 });
    db.runs.push({ id: 1, job_id: 7, triggered_at: 1, source: "manual", status: "success", http_status: 204, error_message: null });
    const res = await req("/1", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(db.accounts).toHaveLength(0);
    expect(db.jobs).toHaveLength(0);
    expect(db.runs).toHaveLength(0);
  });
});
