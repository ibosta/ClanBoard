import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function encKey(): Buffer {
  const raw = process.env.GITHUB_ENCRYPTION_KEY;
  if (!raw) throw new Error("GITHUB_ENCRYPTION_KEY not set");
  // 64 hex chars = 32 bytes. Fall back to sha256 if the value isn't hex.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  // Derive 32 bytes deterministically from arbitrary secret string.
  return Buffer.from(createHmac("sha256", "hyperush-key").update(raw).digest());
}

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptToken(stored: string): string {
  const buf = Buffer.from(stored, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", encKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

function stateSecret(): string {
  const s = process.env.GITHUB_STATE_SECRET;
  if (!s) throw new Error("GITHUB_STATE_SECRET not set");
  return s;
}

export interface StatePayload {
  uid: string;
  origin: string;
  ts: number;
  nonce: string;
}

export function signState(payload: Omit<StatePayload, "ts" | "nonce">): string {
  const full: StatePayload = { ...payload, ts: Date.now(), nonce: randomBytes(8).toString("hex") };
  const body = Buffer.from(JSON.stringify(full)).toString("base64url");
  const sig = createHmac("sha256", stateSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyState(state: string): StatePayload | null {
  try {
    const [body, sig] = state.split(".");
    if (!body || !sig) return null;
    const expected = createHmac("sha256", stateSecret()).update(body).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as StatePayload;
    if (Date.now() - parsed.ts > 10 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}
