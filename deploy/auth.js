import crypto from "node:crypto";
import { loadConfig } from "./config.js";
import { query } from "./db.js";

const SESSION_COOKIE = "hyperush_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function sign(value, secret) {
  const mac = crypto.createHmac("sha256", secret).update(value).digest("base64url");
  return `${value}.${mac}`;
}
function verify(signed, secret) {
  const idx = signed.lastIndexOf(".");
  if (idx < 0) return null;
  const value = signed.slice(0, idx);
  const mac = signed.slice(idx + 1);
  const expected = crypto.createHmac("sha256", secret).update(value).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return crypto.timingSafeEqual(a, b) ? value : null;
}

export function readSession(req) {
  const cfg = loadConfig();
  if (!cfg) return null;
  const raw = req.cookies?.[SESSION_COOKIE];
  if (!raw) return null;
  const value = verify(raw, cfg.sessionSecret);
  if (!value) return null;
  try {
    const data = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (data.exp && data.exp < Date.now() / 1000) return null;
    return data;
  } catch {
    return null;
  }
}

export function writeSession(res, data) {
  const cfg = loadConfig();
  const payload = { ...data, exp: Math.floor(Date.now() / 1000) + MAX_AGE };
  const value = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signed = sign(value, cfg.sessionSecret);
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${signed}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}${
      process.env.NODE_ENV === "production" ? "; Secure" : ""
    }`,
  );
}

export function clearSession(res) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
  );
}

export async function currentUser(req) {
  const s = readSession(req);
  if (!s?.uid) return null;
  const r = await query(
    "SELECT id, email, full_name, avatar_url, role, approved FROM users WHERE id = $1",
    [s.uid],
  );
  return r.rows[0] || null;
}

// ============ Google OAuth ============

export function googleAuthUrl(state) {
  const cfg = loadConfig();
  const params = new URLSearchParams({
    client_id: cfg.googleClientId,
    redirect_uri: `${cfg.appUrl}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function googleExchange(code) {
  const cfg = loadConfig();
  const body = new URLSearchParams({
    code,
    client_id: cfg.googleClientId,
    client_secret: cfg.googleClientSecret,
    redirect_uri: `${cfg.appUrl}/api/auth/google/callback`,
    grant_type: "authorization_code",
  });
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!tokenRes.ok) throw new Error(`google token exchange failed: ${await tokenRes.text()}`);
  const tokens = await tokenRes.json();
  const uRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!uRes.ok) throw new Error("google userinfo failed");
  return uRes.json(); // { sub, email, name, picture, ... }
}

export async function loginOrCreateFromGoogle(profile) {
  const existing = await query("SELECT * FROM users WHERE google_sub = $1", [profile.sub]);
  if (existing.rowCount > 0) return existing.rows[0];

  // Count existing users — if none, this becomes the founding admin.
  const countRes = await query("SELECT COUNT(*)::int AS n FROM users");
  const isFirst = countRes.rows[0].n === 0;

  const insert = await query(
    `INSERT INTO users(google_sub, email, full_name, avatar_url, role, approved, approved_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [
      profile.sub,
      profile.email,
      profile.name || profile.email.split("@")[0],
      profile.picture || null,
      isFirst ? "admin" : "member",
      isFirst,
      isFirst ? new Date() : null,
    ],
  );
  return insert.rows[0];
}
