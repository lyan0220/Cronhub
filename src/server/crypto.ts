// AES-GCM 加密（存 PAT）+ HMAC-SHA256 无状态会话令牌 + 恒定时间密码比较。
// 全部使用 WebCrypto（Node 20+ 全局可用，Workers 原生支持）。

const te = new TextEncoder();

function b64encode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64decode(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function aesKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", te.encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptText(plain: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), te.encode(plain));
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv);
  out.set(new Uint8Array(ct), 12);
  return b64encode(out);
}

export async function decryptText(enc: string, secret: string): Promise<string> {
  const raw = b64decode(enc);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: raw.slice(0, 12) },
    await aesKey(secret),
    raw.slice(12),
  );
  return new TextDecoder().decode(pt);
}

export function tokenFingerprint(token: string): string {
  return `****${token.slice(-4)}`;
}

async function hmacKey(secret: string, domain: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", te.encode(`${domain}:${secret}`));
  return crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

// 令牌格式 epoch.exp.sig。epoch 来自 settings.session_epoch，改密时 +1——
// 校验时 epoch 不匹配即拒绝，从而让改密前签发的所有旧会话整体失效。
// 兼容两段式旧格式（等价于 epoch=0），部署本次改动后存量会话不必集体重登。
export async function createSessionToken(
  secret: string,
  epoch: number = 0,
  now: number = Date.now(),
): Promise<string> {
  const exp = now + SESSION_TTL_MS;
  const key = await hmacKey(secret, "session");
  const sig = await crypto.subtle.sign("HMAC", key, te.encode(String(exp)));
  return `${epoch}.${exp}.${b64encode(sig).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

export async function verifySessionToken(
  token: string,
  secret: string,
  currentEpoch: number = 0,
  now: number = Date.now(),
): Promise<boolean> {
  const parts = token.split(".");
  let epochStr: string, expStr: string, sigPart: string;
  if (parts.length === 3) {
    [epochStr, expStr, sigPart] = parts as [string, string, string];
  } else if (parts.length === 2) {
    epochStr = "0";
    [expStr, sigPart] = parts as [string, string];
  } else {
    return false;
  }
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < now) return false;
  if (Number(epochStr) !== currentEpoch) return false;
  const key = await hmacKey(secret, "session");
  let sig: Uint8Array;
  try {
    sig = b64decode(sigPart.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return false;
  }
  return crypto.subtle.verify("HMAC", key, sig as BufferSource, te.encode(expStr));
}

export async function verifyPassword(input: string, actual: string): Promise<boolean> {
  // 先各自 SHA-256 定长，再逐字节比较，避免时序与长度泄露
  const da = new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(input)));
  const db = new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(actual)));
  let diff = 0;
  for (let i = 0; i < da.length; i++) diff |= da[i] ^ db[i];
  return diff === 0;
}

// ---- 管理员密码哈希（存 D1 settings 表）----

// 迭代次数刻意保守：Workers 免费版单请求 CPU 预算只有 10ms，PBKDF2 是纯 CPU
// 运算。1 万次 ≈ 3-5ms，比明文/单次 SHA-256 强一个量级，又不至于在登录时超限。
const PBKDF2_ITERATIONS = 10_000;

function b64urlEncode(buf: Uint8Array): string {
  return b64encode(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  return b64decode(s.replace(/-/g, "+").replace(/_/g, "/"));
}

async function pbkdf2(pw: string, salt: BufferSource, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", te.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** 存储格式：pbkdf2-sha256$迭代次数$salt(b64url)$哈希(b64url) */
export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await pbkdf2(pw, salt, PBKDF2_ITERATIONS);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${b64urlEncode(salt)}$${b64urlEncode(bits)}`;
}

export async function verifyPasswordHash(stored: string, pw: string): Promise<boolean> {
  const [alg, iterStr, saltB64, hashB64] = stored.split("$");
  if (alg !== "pbkdf2-sha256") return false;
  const iterations = Number(iterStr);
  if (!Number.isFinite(iterations) || iterations < 1) return false;
  const a = await pbkdf2(pw, b64urlDecode(saltB64), iterations);
  let b: Uint8Array;
  try {
    b = b64urlDecode(hashB64);
  } catch {
    return false;
  }
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
