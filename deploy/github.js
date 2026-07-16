import crypto from "node:crypto";
import { loadConfig } from "./config.js";
import { query } from "./db.js";

function keyBuf() {
  const cfg = loadConfig();
  return Buffer.from(cfg.githubEncryptionKey, "base64");
}
export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", keyBuf(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}
export function decrypt(stored) {
  const buf = Buffer.from(stored, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const d = crypto.createDecipheriv("aes-256-gcm", keyBuf(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}

export function githubAuthUrl(state) {
  const cfg = loadConfig();
  const params = new URLSearchParams({
    client_id: cfg.githubClientId,
    redirect_uri: `${cfg.appUrl}/api/auth/github/callback`,
    scope: "repo read:user",
    state,
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export async function githubExchange(code) {
  const cfg = loadConfig();
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "ClanBoard-App",
    },
    body: JSON.stringify({
      client_id: cfg.githubClientId,
      client_secret: cfg.githubClientSecret,
      code,
      redirect_uri: `${cfg.appUrl}/api/auth/github/callback`,
    }),
  });
  if (!res.ok) throw new Error("github exchange failed");
  return res.json();
}

export async function ghFetch(userId, path, opts = {}) {
  const row = await query(
    "SELECT access_token_ciphertext FROM github_connections WHERE user_id = $1",
    [userId],
  );
  if (!row.rowCount) throw new Error("github not connected");
  const token = decrypt(row.rows[0].access_token_ciphertext);
  const res = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "ClanBoard-App",
      ...(opts.headers || {}),
    },
  });
  return res;
}
