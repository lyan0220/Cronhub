import { describe, it, expect } from "vitest";
import { resolveDark } from "../src/client/theme";

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
