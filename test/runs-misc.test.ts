import { describe, it, expect, beforeEach } from "vitest";
import runRoutes from "../src/server/routes/runs";
import miscRoutes from "../src/server/routes/misc";
import { FakeD1 } from "./helpers/fake-d1";
import type { Env } from "../src/server/types";

let db: FakeD1;
let env: Env;
beforeEach(() => {
  db = new FakeD1();
  env = { DB: db as unknown as D1Database, ASSETS: null as never, ADMIN_PASSWORD: "pw", TOKEN_ENC_KEY: "k" };
  db.jobs.push({ id: 1, name: "job1", account_id: 1, repo: "a/b", trigger_type: "workflow_dispatch", workflow_id: "x.yml", event_type: null, ref: "main", inputs_json: null, schedule_json: "{}", enabled: 1, next_run_at: 0, last_run_at: null, created_at: 0, updated_at: 0 });
  db.runs.push(
    { id: 1, job_id: 1, triggered_at: 100, source: "schedule", status: "success", http_status: 204, error_message: null },
    { id: 2, job_id: 1, triggered_at: 200, source: "manual", status: "failed", http_status: 401, error_message: "GitHub API 401" },
    { id: 3, job_id: 9, triggered_at: 300, source: "schedule", status: "success", http_status: 204, error_message: null },
  );
});

describe("runs 路由", () => {
  it("列表按时间倒序并带 job_name", async () => {
    const res = await runRoutes.request("/", {}, env);
    const json = (await res.json()) as { data: { total: number; rows: Array<{ id: number; job_name: string | null }> } };
    expect(json.data.total).toBe(3);
    expect(json.data.rows).toHaveLength(3);
    expect(json.data.rows[0].id).toBe(3);
    expect(json.data.rows[0].job_name).toBeNull();
    expect(json.data.rows[2].job_name).toBe("job1");
  });
  it("按 job_id 筛选", async () => {
    const res = await runRoutes.request("/?job_id=1", {}, env);
    const json = (await res.json()) as { data: { total: number } };
    expect(json.data.total).toBe(2);
  });
  it("status=success 只返回成功记录", async () => {
    const res = await runRoutes.request("/?status=success", {}, env);
    const json = (await res.json()) as { data: { total: number; rows: Array<{ id: number; status: string }> } };
    expect(json.data.total).toBe(2);
    expect(json.data.rows.map((r) => r.id)).toEqual([3, 1]);
    expect(json.data.rows.every((r) => r.status === "success")).toBe(true);
  });
  it("status=failed 只返回失败记录", async () => {
    const res = await runRoutes.request("/?status=failed", {}, env);
    const json = (await res.json()) as { data: { total: number; rows: Array<{ id: number; status: string }> } };
    expect(json.data.total).toBe(1);
    expect(json.data.rows.map((r) => r.id)).toEqual([2]);
    expect(json.data.rows[0].status).toBe("failed");
  });
  it("无 status 返回全部记录", async () => {
    const res = await runRoutes.request("/", {}, env);
    const json = (await res.json()) as { data: { total: number; rows: unknown[] } };
    expect(json.data.total).toBe(3);
    expect(json.data.rows).toHaveLength(3);
  });
  it("status 与 job_id 组合过滤", async () => {
    const res = await runRoutes.request("/?job_id=1&status=failed", {}, env);
    const json = (await res.json()) as { data: { total: number; rows: Array<{ id: number; job_id: number; status: string }> } };
    expect(json.data.total).toBe(1);
    expect(json.data.rows.map((r) => r.id)).toEqual([2]);
    expect(json.data.rows[0].job_id).toBe(1);
    expect(json.data.rows[0].status).toBe("failed");
  });
  it("cleanup 删除过期记录", async () => {
    db.runs.push({ id: 4, job_id: 1, triggered_at: Date.now() - 91 * 24 * 3600 * 1000, source: "schedule", status: "success", http_status: 204, error_message: null });
    const res = await runRoutes.request("/cleanup", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }, env);
    const json = (await res.json()) as { data: { deleted: number } };
    expect(json.data.deleted).toBe(1);
    expect(db.runs).toHaveLength(3);
  });
});

describe("misc 路由", () => {
  it("stats 返回计数", async () => {
    const res = await miscRoutes.request("/stats", {}, env);
    const json = (await res.json()) as { data: Record<string, number> };
    expect(json.data).toMatchObject({ total_jobs: 1, enabled_jobs: 1 });
  });
  it("cron/preview 返回 5 个时间与描述", async () => {
    const rule = encodeURIComponent(JSON.stringify({ type: "interval", mode: "fixed", value: 30, unit: "m" }));
    const res = await miscRoutes.request(`/cron/preview?rule=${rule}`, {}, env);
    const json = (await res.json()) as { data: { times: number[]; describe: string } };
    expect(json.data.times).toHaveLength(5);
    expect(json.data.describe).toContain("30");
  });
  it("非法规则返回 400", async () => {
    const rule = encodeURIComponent(JSON.stringify({ type: "cron", expr: "bad" }));
    const res = await miscRoutes.request(`/cron/preview?rule=${rule}`, {}, env);
    expect(res.status).toBe(400);
  });
});
