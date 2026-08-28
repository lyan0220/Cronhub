import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runDueJobs, triggerJobOnce } from "../src/server/scheduler";
import { encryptText } from "../src/server/crypto";
import { FakeD1 } from "./helpers/fake-d1";
import type { Env } from "../src/server/types";

const NOW = 1_800_000_000_000; // 固定"当前时间"

async function makeEnv(): Promise<{ env: Env; db: FakeD1 }> {
  const db = new FakeD1();
  const env = { DB: db as unknown as D1Database, ASSETS: null as never, ADMIN_PASSWORD: "pw", TOKEN_ENC_KEY: "enckey" };
  db.accounts.push({
    id: 1, name: "acc1", github_login: "alice",
    token_encrypted: await encryptText("ghp_test_token", "enckey"),
    token_fingerprint: "****oken", status: "ok", last_verified_at: NOW,
    created_at: NOW, updated_at: NOW,
  });
  return { env, db };
}

function addJob(db: FakeD1, over: Record<string, unknown> = {}) {
  db.jobs.push({
    id: 1, name: "job1", account_id: 1, repo: "alice/repo1",
    trigger_type: "workflow_dispatch", workflow_id: "run.yml", event_type: null,
    ref: "main", inputs_json: null,
    schedule_json: JSON.stringify({ type: "interval", mode: "fixed", value: 45, unit: "m" }),
    enabled: 1, next_run_at: NOW - 1_000, last_run_at: null, created_at: NOW, updated_at: NOW,
    ...over,
  });
}

describe("runDueJobs", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    // recordRun 用真实 Date.now() 记录触发时刻；mock 成 NOW 使其与固定 now 一致，
    // 否则 90 天清理会把"真实时间早于 NOW-90d"的新记录误删（测试环境时间差）。
    vi.spyOn(Date, "now").mockReturnValue(NOW);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("到期任务被触发并写回下次时间与运行记录", async () => {
    const { env, db } = await makeEnv();
    addJob(db);
    const r = await runDueJobs(env, NOW);
    expect(r).toEqual({ triggered: 1, failed: 0 });
    expect(db.jobs[0].next_run_at).toBe(NOW - 1_000 + 45 * 60_000); // 基于原计划时间
    expect(db.jobs[0].last_run_at).toBe(NOW);
    expect(db.runs).toHaveLength(1);
    expect(db.runs[0].status).toBe("success");
    expect(db.runs[0].source).toBe("schedule");
  });

  it("未到期任务不触发", async () => {
    const { env, db } = await makeEnv();
    addJob(db, { next_run_at: NOW + 999_999 });
    const r = await runDueJobs(env, NOW);
    expect(r).toEqual({ triggered: 0, failed: 0 });
    expect(db.runs).toHaveLength(0);
  });

  it("停用任务不触发", async () => {
    const { env, db } = await makeEnv();
    addJob(db, { enabled: 0 });
    const r = await runDueJobs(env, NOW);
    expect(r).toEqual({ triggered: 0, failed: 0 });
  });

  it("GitHub 401 时账号被标记 invalid 且记失败", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 })));
    const { env, db } = await makeEnv();
    addJob(db);
    const r = await runDueJobs(env, NOW);
    expect(r.failed).toBe(1);
    expect(db.accounts[0].status).toBe("invalid");
    expect(db.runs[0].status).toBe("failed");
    expect(db.runs[0].error_message).toContain("401");
  });

  it("乐观锁：任务被其他实例处理过则跳过", async () => {
    const { env, db } = await makeEnv();
    addJob(db, { next_run_at: NOW - 1_000 });
    // 模拟另一实例已把 next_run_at 推后：在乐观锁 UPDATE 参数绑定之后、执行之前并发修改
    const job = db.jobs[0] as Record<string, unknown>;
    const origPrepare = db.prepare.bind(db);
    let bumped = false;
    db.prepare = (sql: string) => {
      const stmt = origPrepare(sql);
      if (/WHERE id=\? AND next_run_at=\? AND enabled=1/.test(sql)) {
        const origBind = stmt.bind.bind(stmt);
        stmt.bind = (...params: unknown[]) => {
          const bound = origBind(...params);
          if (!bumped) {
            bumped = true;
            job.next_run_at = NOW + 999_999; // 在 UPDATE 执行前被并发修改
          }
          return bound;
        };
      }
      return stmt;
    };
    const r = await runDueJobs(env, NOW);
    expect(r).toEqual({ triggered: 0, failed: 0 });
    expect(db.runs).toHaveLength(0);
  });

  it("单任务 schedule_json 损坏不影响其余任务：runDueJobs 不 reject、后续任务正常触发", async () => {
    const { env, db } = await makeEnv();
    // 第一个任务 next_run_at 更早（排序在前），schedule_json 为损坏 JSON
    addJob(db, { id: 1, next_run_at: NOW - 2_000, schedule_json: "{oops" });
    addJob(db, { id: 2, name: "job2", next_run_at: NOW - 1_000 });
    const r = await runDueJobs(env, NOW); // 不应 reject（单个任务异常被隔离）
    expect(r).toEqual({ triggered: 1, failed: 1 });
    // 第二个任务仍被触发并推进 next_run_at
    const job2 = db.jobs.find((j) => j.id === 2) as Record<string, unknown>;
    expect(job2.next_run_at).toBe(NOW - 1_000 + 45 * 60_000);
    const successRuns = db.runs.filter((x) => x.job_id === 2 && x.status === "success");
    expect(successRuns).toHaveLength(1);
    // 损坏任务也要推进 next_run_at，防止每 5 分钟热循环重试
    const job1 = db.jobs.find((j) => j.id === 1) as Record<string, unknown>;
    expect((job1.next_run_at as number)).toBeGreaterThan(NOW);
  });

  it("cron 无可达触发时间（如 0 0 29 2 *）不 reject 且 next_run_at 兜底推进", async () => {
    const { env, db } = await makeEnv();
    addJob(db, { schedule_json: JSON.stringify({ type: "cron", expr: "0 0 29 2 *" }) });
    const r = await runDueJobs(env, NOW); // 不应 reject（抛错被隔离）
    expect(r).toEqual({ triggered: 0, failed: 1 });
    // 不产生成功 runs；失败已记录
    expect(db.runs.filter((x) => x.status === "success")).toHaveLength(0);
    expect((db.jobs[0].next_run_at as number)).toBeGreaterThan(NOW); // 兜底推进防热循环
  });

  it("清理 90 天前的运行记录", async () => {
    const { env, db } = await makeEnv();
    db.runs.push({ id: 1, job_id: 1, triggered_at: NOW - 91 * 24 * 3600 * 1000, source: "schedule", status: "success", http_status: 204, error_message: null });
    db.runs.push({ id: 2, job_id: 1, triggered_at: NOW - 10 * 24 * 3600 * 1000, source: "schedule", status: "success", http_status: 204, error_message: null });
    await runDueJobs(env, NOW);
    expect(db.runs).toHaveLength(1);
    expect((db.runs[0] as Record<string, unknown>).id).toBe(2);
  });
});

describe("triggerJobOnce", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 }))));
  afterEach(() => vi.unstubAllGlobals());

  it("手动触发记录 source=manual 且不改 next_run_at", async () => {
    const { env, db } = await makeEnv();
    addJob(db, { next_run_at: NOW + 500_000 });
    const r = await triggerJobOnce(env, 1, "manual");
    if (!("ok" in r)) throw new Error("应找到任务");
    expect(r.ok).toBe(true);
    expect(db.runs[0].source).toBe("manual");
    expect(db.jobs[0].next_run_at).toBe(NOW + 500_000);
  });

  it("任务不存在返回 notFound", async () => {
    const { env } = await makeEnv();
    const r = await triggerJobOnce(env, 99, "manual");
    expect(r).toEqual({ notFound: true });
  });
});
