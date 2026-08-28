import { describe, it, expect, vi } from "vitest";
import { triggerGithub, verifyGithubToken } from "../src/server/github";

function res(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

describe("triggerGithub", () => {
  const wfCfg = {
    repo: "alice/repo1", triggerType: "workflow_dispatch" as const,
    workflowId: "run.yml", ref: "main", inputsJson: null,
  };

  it("204 视为成功", async () => {
    const fn = vi.fn(async () => res(204));
    const r = await triggerGithub("tok", wfCfg, fn as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, httpStatus: 204 });
  });
  it("workflow_dispatch 请求 URL 与 body 正确", async () => {
    const fn = vi.fn(async (_url: string, _init?: RequestInit) => res(204));
    await triggerGithub("tok", { ...wfCfg, inputsJson: '{"foo":"bar"}' }, fn as unknown as typeof fetch);
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/alice/repo1/actions/workflows/run.yml/dispatches");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ ref: "main", inputs: { foo: "bar" } });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });
  it("repository_dispatch 请求正确", async () => {
    const fn = vi.fn(async (_url: string, _init?: RequestInit) => res(204));
    await triggerGithub("tok", {
      repo: "bob/repo2", triggerType: "repository_dispatch",
      eventType: "cron", inputsJson: '{"k":"v"}',
    }, fn as unknown as typeof fetch);
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/bob/repo2/dispatches");
    expect(JSON.parse(init.body as string)).toEqual({ event_type: "cron", client_payload: { k: "v" } });
  });
  it("404 返回错误并带 GitHub 消息", async () => {
    const r = await triggerGithub("tok", wfCfg, (async () => res(404, { message: "Not Found" })) as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.httpStatus).toBe(404);
      expect(r.error).toContain("Not Found");
    }
  });
  it("非法 inputs JSON 报错", async () => {
    const r = await triggerGithub("tok", { ...wfCfg, inputsJson: "not-json" }, (async () => res(204)) as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("inputs");
  });
});

describe("verifyGithubToken", () => {
  it("有效 token 返回 login", async () => {
    const r = await verifyGithubToken("tok", (async () => res(200, { login: "alice" })) as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, login: "alice" });
  });
  it("401 返回错误", async () => {
    const r = await verifyGithubToken("bad", (async () => res(401)) as unknown as typeof fetch);
    expect(r.ok).toBe(false);
  });
});
