import { describe, it, expect } from "vitest";
import { validateSchedule, computeNextRun, describeSchedule } from "../src/server/schedule";

const M = 60_000, H = 3_600_000, d = 86_400_000;

describe("validateSchedule", () => {
  it("接受合法 cron", () => {
    expect(validateSchedule({ type: "cron", expr: "30 3 * * *" })).toEqual({ ok: true, rule: { type: "cron", expr: "30 3 * * *" } });
  });
  it("拒绝非法 cron 并给出中文错误", () => {
    const r = validateSchedule({ type: "cron", expr: "61 * * * *" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("cron");
  });
  it("接受固定间隔", () => {
    expect(validateSchedule({ type: "interval", mode: "fixed", value: 45, unit: "m" }).ok).toBe(true);
  });
  it("拒绝非法单位与数值", () => {
    expect(validateSchedule({ type: "interval", mode: "fixed", value: 45, unit: "s" }).ok).toBe(false);
    expect(validateSchedule({ type: "interval", mode: "fixed", value: 0, unit: "m" }).ok).toBe(false);
  });
  it("拒绝 min>max 的随机间隔", () => {
    expect(validateSchedule({ type: "interval", mode: "random", min: 90, max: 30, unit: "m" }).ok).toBe(false);
  });
  it("拒绝未知类型", () => {
    expect(validateSchedule({ type: "nope" }).ok).toBe(false);
    expect(validateSchedule("x").ok).toBe(false);
  });
});

describe("computeNextRun", () => {
  it("固定间隔基于计划时间累加", () => {
    expect(computeNextRun({ type: "interval", mode: "fixed", value: 45, unit: "m" }, 1000)).toBe(1000 + 45 * M);
    expect(computeNextRun({ type: "interval", mode: "fixed", value: 6, unit: "h" }, 0)).toBe(6 * H);
    expect(computeNextRun({ type: "interval", mode: "fixed", value: 2, unit: "d" }, 0)).toBe(2 * d);
  });
  it("随机间隔使用注入的 rand 并落在 [min,max]", () => {
    expect(computeNextRun({ type: "interval", mode: "random", min: 30, max: 90, unit: "m" }, 0, () => 0)).toBe(30 * M);
    expect(computeNextRun({ type: "interval", mode: "random", min: 30, max: 90, unit: "m" }, 0, () => 0.999999)).toBeGreaterThanOrEqual(30 * M);
    expect(computeNextRun({ type: "interval", mode: "random", min: 30, max: 90, unit: "m" }, 0, () => 0.999999)).toBeLessThan(90 * M);
    expect(computeNextRun({ type: "interval", mode: "random", min: 30, max: 90, unit: "m" }, 0, () => 0.5)).toBe(60 * M);
  });
  it("cron 类型委托给 nextCronTime", () => {
    const base = Date.UTC(2026, 7, 28, 10, 30);
    expect(computeNextRun({ type: "cron", expr: "31 10 * * *" }, base)).toBe(Date.UTC(2026, 7, 28, 10, 31));
  });
});

describe("describeSchedule", () => {
  it("cron", () => expect(describeSchedule({ type: "cron", expr: "30 3 * * *" })).toContain("30 3 * * *"));
  it("固定间隔", () => expect(describeSchedule({ type: "interval", mode: "fixed", value: 45, unit: "m" })).toContain("45"));
  it("随机间隔", () => expect(describeSchedule({ type: "interval", mode: "random", min: 30, max: 90, unit: "m" })).toContain("30~90"));
});
