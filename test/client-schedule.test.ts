import { describe, it, expect } from "vitest";
import { EMPTY_SCHEDULE, parseSchedule, describeLocal } from "../src/client/pages/Jobs/schedule";

describe("parseSchedule", () => {
  it("解析合法 JSON", () => {
    expect(parseSchedule('{"type":"cron","expr":"30 3 * * *"}'))
      .toEqual({ type: "cron", expr: "30 3 * * *" });
  });
  it("非法 JSON 兜底为默认间隔规则，不抛错", () => {
    expect(parseSchedule("{坏数据")).toEqual(EMPTY_SCHEDULE);
    expect(parseSchedule("")).toEqual(EMPTY_SCHEDULE);
  });
  it("合法 JSON 但不是对象也兜底", () => {
    expect(parseSchedule("42")).toEqual(EMPTY_SCHEDULE);
    expect(parseSchedule("null")).toEqual(EMPTY_SCHEDULE);
    expect(parseSchedule("[1,2]")).toEqual(EMPTY_SCHEDULE);
  });
});

describe("describeLocal", () => {
  it("cron 规则标注 UTC", () => {
    expect(describeLocal({ type: "cron", expr: "30 3 * * *" })).toBe("cron 30 3 * * *（UTC）");
  });
  it("固定间隔", () => {
    expect(describeLocal({ type: "interval", mode: "fixed", value: 45, unit: "m" })).toBe("每 45 分钟");
    expect(describeLocal({ type: "interval", mode: "fixed", value: 6, unit: "h" })).toBe("每 6 小时");
  });
  it("随机间隔", () => {
    expect(describeLocal({ type: "interval", mode: "random", min: 30, max: 90, unit: "m" }))
      .toBe("每 30~90 分钟（随机）");
  });
  it("缺字段时不崩，按默认单位处理", () => {
    expect(describeLocal({ type: "cron" })).toBe("cron（UTC）");
    expect(describeLocal({ type: "interval", mode: "fixed", value: 5 })).toBe("每 5 分钟");
  });
});
