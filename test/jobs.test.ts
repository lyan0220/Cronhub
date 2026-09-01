import { describe, it, expect, beforeEach, vi } from "vitest";
import jobRoutes from "../src/server/routes/jobs";
import { encryptText } from "../src/server/crypto";
import { FakeD1 } from "./helpers/fake-d1";
import type { Env } from "../src/server/types";

let db: FakeD1;
let env: Env;
beforeEach(async () => {
  db = new FakeD1();
  env = { DB: db as unknown as D1Database, ASSETS: null as never, ADMIN_PASSWORD: "pw", TOKEN_ENC_KEY: "enckey" };
  db.accounts.push({
    id: 1, name: "acc1", github_login: "alice",
    token_encrypted: await encryptText("ghp_existing_token_xxxx", "enckey"),
    token_fingerprint: "****xxxx", status: "ok", last_verified_at: 1, created_at: 1, updated_at: 1,
  });
});

function req(path: string, init?: RequestInit) {
  return jobRoutes.request(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers as Record<string, string>) },
  }, env);
}

const validBody = {
  name: "每日签到", account_id: 1, repo: "alice/repo1",
  trigger_type: "workflow_dispatch", workflow_id: "run.yml", ref: "main",
  inputs_json: null,
  schedule: { type: "interval", mode: "fixed", value: 45, unit: "m" },
};

describe("任务路由", () => {
  it("创建任务成功并算出 next_run_at", async () => {
    const res = await req("/", { method: "POST", body: JSON.stringify(validBody) });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { data: { next_run_at: number } };
    expect(json.data.next_run_at).toBeGreaterThan(Date.now());
    expect(json.data.next_run_at).toBeLessThanOrEqual(Date.now() + 46 * 60_000);
    expect(db.jobs).toHaveLength(1);
  });

  it("repository_dispatch 任务创建成功", async () => {
    const res = await req("/", {
      method: "POST",
      body: JSON.stringify({ ...validBody, trigger_type: "repository_dispatch", workflow_id: null, event_type: "cron" }),
    });
    expect(res.status).toBe(201);
  });

  it("带斜杠的分支名 / 标签 / 子目录 workflow 可以创建", async () => {
    for (const ref of ["feature/x", "release/v1.0", "refs/heads/main", "a1b2c3d4"]) {
      const res = await req("/", { method: "POST", body: JSON.stringify({ ...validBody, ref }) });
      expect(res.status).toBe(201);
    }
    const sub = await req("/", {
      method: "POST",
      body: JSON.stringify({ ...validBody, workflow_id: "build/test.yml" }),
    });
    expect(sub.status).toBe(201);
  });

  it("明显非法的 ref 被拒绝", async () => {
    for (const ref of ["-flag", ".hidden", "a..b", "x.lock", "trailing/", "空 格"]) {
      const res = await req("/", { method: "POST", body: JSON.stringify({ ...validBody, ref }) });
      expect(res.status).toBe(400);
    }
  });

  it("非法参数被拒绝", async () => {
    const cases = [
      { ...validBody, name: "" },
      { ...validBody, repo: "不合法" },
      { ...validBody, trigger_type: "workflow_dispatch", workflow_id: "" },
      { ...validBody, schedule: { type: "cron", expr: "bad" } },
      { ...validBody, inputs_json: "not-json" },
      { ...validBody, account_id: 999 },
    ];
    for (const body of cases) {
      const res = await req("/", { method: "POST", body: JSON.stringify(body) });
      expect(res.status).toBe(400);
    }
    expect(db.jobs).toHaveLength(0);
  });

  it("列表带 account_name", async () => {
    await req("/", { method: "POST", body: JSON.stringify(validBody) });
    const res = await req("/");
    const json = (await res.json()) as { data: Array<{ account_name: string }> };
    expect(json.data[0].account_name).toBe("acc1");
  });

  it("toggle 停用再启用，启用时重算 next_run_at", async () => {
    await req("/", { method: "POST", body: JSON.stringify(validBody) });
    await req("/1/toggle", { method: "POST" });
    expect(db.jobs[0].enabled).toBe(0);
    await req("/1/toggle", { method: "POST" });
    expect(db.jobs[0].enabled).toBe(1);
    expect(db.jobs[0].next_run_at as number).toBeGreaterThan(Date.now());
  });

  it("schedule_json 损坏时启用不 500，沿用原 next_run_at", async () => {
    await req("/", { method: "POST", body: JSON.stringify(validBody) });
    await req("/1/toggle", { method: "POST" });
    db.jobs[0].schedule_json = "{broken";
    const before = db.jobs[0].next_run_at;
    const res = await req("/1/toggle", { method: "POST" });
    expect(res.status).toBe(200);
    expect(db.jobs[0].enabled).toBe(1);
    expect(db.jobs[0].next_run_at).toBe(before);
  });

  it("手动触发调用 GitHub 并记录 manual", async () => {
    const fn = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fn);
    await req("/", { method: "POST", body: JSON.stringify(validBody) });
    const res = await req("/1/trigger", { method: "POST" });
    expect(res.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(db.runs[0].source).toBe("manual");
    vi.unstubAllGlobals();
  });

  it("删除任务同时删除其运行记录", async () => {
    await req("/", { method: "POST", body: JSON.stringify(validBody) });
    db.runs.push({ id: 1, job_id: 1, triggered_at: 1, source: "manual", status: "success", http_status: 204, error_message: null });
    await req("/1", { method: "DELETE" });
    expect(db.jobs).toHaveLength(0);
    expect(db.runs).toHaveLength(0);
  });
});
