import { describe, it, expect } from "vitest";
import { parseCron, nextCronTime } from "../src/server/cron";

describe("parseCron", () => {
  it("解析 * * * * *", () => {
    const f = parseCron("* * * * *");
    expect(f.minutes.size).toBe(60);
    expect(f.doms).toBeNull();
    expect(f.dows).toBeNull();
  });
  it("支持步长 */15", () => {
    expect(parseCron("*/15 * * * *").minutes).toEqual(new Set([0, 15, 30, 45]));
  });
  it("支持区间与列表 1-3,40", () => {
    expect(parseCron("1-3,40 * * * *").minutes).toEqual(new Set([1, 2, 3, 40]));
  });
  it("支持区间步长 10-50/20", () => {
    expect(parseCron("10-50/20 * * * *").minutes).toEqual(new Set([10, 30, 50]));
  });
  it("星期 7 归一化为 0", () => {
    expect(parseCron("* * * * 7").dows).toEqual(new Set([0]));
  });
  it("拒绝字段数不足", () => {
    expect(() => parseCron("* * * *")).toThrow();
  });
  it("拒绝越界值", () => {
    expect(() => parseCron("61 * * * *")).toThrow();
    expect(() => parseCron("* 24 * * *")).toThrow();
  });
  it("拒绝非法字符", () => {
    expect(() => parseCron("abc * * * *")).toThrow();
  });
});

describe("nextCronTime", () => {
  // 2026-08-28 10:30 UTC 是周五
  const base = Date.UTC(2026, 7, 28, 10, 30);

  it("每小时第 0 分 → 下一整点", () => {
    expect(nextCronTime("0 * * * *", base)).toBe(Date.UTC(2026, 7, 28, 11, 0));
  });
  it("每天 03:30 → 明天", () => {
    expect(nextCronTime("30 3 * * *", base)).toBe(Date.UTC(2026, 7, 29, 3, 30));
  });
  it("下一分钟命中", () => {
    expect(nextCronTime("31 10 * * *", base)).toBe(Date.UTC(2026, 7, 28, 10, 31));
  });
  it("每周五 00:00 → 下周五", () => {
    expect(nextCronTime("0 0 * * 5", base)).toBe(Date.UTC(2026, 8, 4, 0, 0));
  });
  it("日与周同时受限取或语义（周一或每月1号）→ 周一 8/31", () => {
    expect(nextCronTime("0 0 1 * 1", base)).toBe(Date.UTC(2026, 7, 31, 0, 0));
  });
  it("仅日期受限 → 9月1日", () => {
    expect(nextCronTime("0 0 1 * *", base)).toBe(Date.UTC(2026, 8, 1, 0, 0));
  });
  it("找不到未来时间时抛错", () => {
    expect(() => nextCronTime("0 0 30 2 *", base)).toThrow();
  });
});
