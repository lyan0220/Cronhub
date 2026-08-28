// AES-GCM 加密（存 PAT）+ HMAC-SHA256 无状态会话令牌 + 恒定时间密码比较。
// 全部使用 WebCrypto（Node 20+ 全局可用，Workers 原生支持）。

const te = new TextEncoder();

function b64encode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
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

export async function createSessionToken(secret: string, now: number = Date.now()): Promise<string> {
  const exp = now + SESSION_TTL_MS;
  const key = await hmacKey(secret, "session");
  const sig = await crypto.subtle.sign("HMAC", key, te.encode(String(exp)));
  return `${exp}.${b64encode(sig).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

export async function verifySessionToken(token: string, secret: string, now: number = Date.now()): Promise<boolean> {
  const [expStr, sigPart] = token.split(".");
  if (!expStr || !sigPart) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < now) return false;
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
