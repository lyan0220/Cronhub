import { describe, it, expect } from "vitest";
import { fmtShort, relativeTime } from "../src/client/utils/time";

const NOW = Date.UTC(2026, 7, 31, 6, 0, 0); // 2026-08-31 06:00 UTC

describe("relativeTime", () => {
  it("空值返回短横线", () => {
    expect(relativeTime(null, NOW)).toBe("-");
    expect(relativeTime(undefined, NOW)).toBe("-");
  });
  it("一分钟内的过去是刚刚", () => {
    expect(relativeTime(NOW - 30_000, NOW)).toBe("刚刚");
  });
  it("一分钟内的未来是即将", () => {
    expect(relativeTime(NOW + 30_000, NOW)).toBe("即将");
  });
  it("过去用前缀后缀「前」", () => {
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe("5 分钟前");
    expect(relativeTime(NOW - 2 * 3_600_000, NOW)).toBe("2 小时前");
    expect(relativeTime(NOW - 3 * 86_400_000, NOW)).toBe("3 天前");
  });
  it("未来用后缀「后」", () => {
    expect(relativeTime(NOW + 45 * 60_000, NOW)).toBe("45 分钟后");
    expect(relativeTime(NOW + 2 * 3_600_000, NOW)).toBe("2 小时后");
    expect(relativeTime(NOW + 10 * 86_400_000, NOW)).toBe("10 天后");
  });
  it("向下取整，不四舍五入", () => {
    expect(relativeTime(NOW + 119 * 60_000, NOW)).toBe("1 小时后");
  });
});

describe("fmtShort", () => {
  it("空值返回短横线", () => {
    expect(fmtShort(null)).toBe("-");
  });
  it("输出 MM-DD HH:mm，不含年和秒", () => {
    expect(fmtShort(new Date(2026, 7, 31, 14, 30, 5).getTime())).toBe("08-31 14:30");
  });
});
