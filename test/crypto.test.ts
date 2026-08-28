import { describe, it, expect } from "vitest";
import {
  encryptText, decryptText, tokenFingerprint,
  createSessionToken, verifySessionToken, verifyPassword,
} from "../src/server/crypto";

describe("AES-GCM 文本加密", () => {
  it("加解密往返", async () => {
    const enc = await encryptText("ghp_abc123", "key1");
    expect(enc).not.toContain("ghp_abc123");
    expect(await decryptText(enc, "key1")).toBe("ghp_abc123");
  });
  it("错误密钥解密失败", async () => {
    const enc = await encryptText("ghp_abc123", "key1");
    await expect(decryptText(enc, "key2")).rejects.toThrow();
  });
  it("相同明文两次加密产生不同密文（随机 IV）", async () => {
    expect(await encryptText("x", "k")).not.toBe(await encryptText("x", "k"));
  });
});

describe("token 指纹", () => {
  it("只保留末 4 位", () => {
    expect(tokenFingerprint("ghp_" + "a".repeat(36) + "wxyz")).toBe("****wxyz");
  });
});

describe("会话令牌", () => {
  it("创建后可验证", async () => {
    const t = await createSessionToken("secret");
    expect(await verifySessionToken(t, "secret")).toBe(true);
  });
  it("过期后验证失败", async () => {
    const t = await createSessionToken("secret", 0);
    expect(await verifySessionToken(t, "secret", 8 * 24 * 3600 * 1000)).toBe(false);
  });
  it("密钥不同验证失败", async () => {
    const t = await createSessionToken("secret");
    expect(await verifySessionToken(t, "other")).toBe(false);
  });
  it("篡改令牌验证失败", async () => {
    const t = await createSessionToken("secret");
    expect(await verifySessionToken(t.slice(0, -2) + "xx", "secret")).toBe(false);
  });
});

describe("密码验证", () => {
  it("正确密码", async () => expect(await verifyPassword("abc", "abc")).toBe(true));
  it("错误密码", async () => expect(await verifyPassword("abc", "abd")).toBe(false));
});
