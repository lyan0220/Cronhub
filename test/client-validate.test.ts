import { describe, it, expect } from "vitest";
import { validateRepo, validateInputsJson } from "../src/client/utils/validate";

describe("validateRepo", () => {
  it("合法 owner/repo 返回 null", () => {
    expect(validateRepo("alice/repo1")).toBeNull();
    expect(validateRepo("my-org/my.repo_2")).toBeNull();
  });
  it("空值报错", () => {
    expect(validateRepo("")).toBe("仓库不能为空");
    expect(validateRepo("   ")).toBe("仓库不能为空");
  });
  it("缺少斜杠或多余斜杠报错", () => {
    expect(validateRepo("repo1")).toBe("格式应为 owner/repo");
    expect(validateRepo("a/b/c")).toBe("格式应为 owner/repo");
  });
  it("含非法字符报错", () => {
    expect(validateRepo("ali ce/repo")).toBe("格式应为 owner/repo");
    expect(validateRepo("https://github.com/a/b")).toBe("格式应为 owner/repo");
  });
});

describe("validateInputsJson", () => {
  it("留空是合法的", () => {
    expect(validateInputsJson("")).toBeNull();
    expect(validateInputsJson("  \n ")).toBeNull();
  });
  it("合法 JSON 对象返回 null", () => {
    expect(validateInputsJson('{"environment":"prod"}')).toBeNull();
    expect(validateInputsJson("{}")).toBeNull();
  });
  it("语法错误报错", () => {
    expect(validateInputsJson("{foo}")).toBe("不是合法的 JSON");
    expect(validateInputsJson('{"a":1,}')).toBe("不是合法的 JSON");
  });
  it("合法 JSON 但不是对象要报错", () => {
    expect(validateInputsJson("[1,2]")).toBe("必须是 JSON 对象，不能是数组或基本类型");
    expect(validateInputsJson("123")).toBe("必须是 JSON 对象，不能是数组或基本类型");
    expect(validateInputsJson('"str"')).toBe("必须是 JSON 对象，不能是数组或基本类型");
    expect(validateInputsJson("null")).toBe("必须是 JSON 对象，不能是数组或基本类型");
  });
});
