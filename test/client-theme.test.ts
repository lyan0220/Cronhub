import { describe, it, expect, afterEach, vi } from "vitest";
import { resolveDark, readThemePref } from "../src/client/theme";

describe("resolveDark", () => {
  it("light 偏好始终为浅色，忽略系统", () => {
    expect(resolveDark("light", true)).toBe(false);
    expect(resolveDark("light", false)).toBe(false);
  });
  it("dark 偏好始终为深色，忽略系统", () => {
    expect(resolveDark("dark", true)).toBe(true);
    expect(resolveDark("dark", false)).toBe(true);
  });
  it("system 偏好跟随系统", () => {
    expect(resolveDark("system", true)).toBe(true);
    expect(resolveDark("system", false)).toBe(false);
  });
});

describe("readThemePref", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("没有存过 theme 时返回 system", () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    expect(readThemePref()).toBe("system");
  });

  it("存的是合法值时原样返回", () => {
    vi.stubGlobal("localStorage", { getItem: () => "dark" });
    expect(readThemePref()).toBe("dark");
    vi.stubGlobal("localStorage", { getItem: () => "light" });
    expect(readThemePref()).toBe("light");
  });

  it("存的是未知值时归一化为 system", () => {
    vi.stubGlobal("localStorage", { getItem: () => "blue" });
    expect(readThemePref()).toBe("system");
  });

  it("访问 localStorage 抛异常时返回 system 且不抛出", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("被浏览器阻止");
      },
    });
    expect(() => readThemePref()).not.toThrow();
    expect(readThemePref()).toBe("system");
  });
});
