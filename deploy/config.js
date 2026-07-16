import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DATA_DIR = process.env.APP_DATA_DIR || "/data";
const CONFIG_PATH = path.join(DATA_DIR, "config.json");

let cached = null;

export function isSetupComplete() {
  return cached !== null && !!cached.googleClientId && !!cached.googleClientSecret;
}

export function loadConfig() {
  if (cached) return cached;
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      cached = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
      return cached;
    }
  } catch (err) {
    console.error("[config] load failed:", err);
  }
  cached = null;
  return null;
}

export function saveConfig(input) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const existing = loadConfig() || {};
  const next = {
    brand: (input.brand || existing.brand || "Hyperush").trim(),
    appUrl: (input.appUrl || existing.appUrl || "").replace(/\/$/, ""),
    googleClientId: (input.googleClientId || existing.googleClientId || "").trim(),
    googleClientSecret: (input.googleClientSecret || existing.googleClientSecret || "").trim(),
    githubClientId: (input.githubClientId || existing.githubClientId || "").trim(),
    githubClientSecret: (input.githubClientSecret || existing.githubClientSecret || "").trim(),
    sessionSecret: existing.sessionSecret || crypto.randomBytes(32).toString("hex"),
    githubEncryptionKey: existing.githubEncryptionKey || crypto.randomBytes(32).toString("base64"),
    supportEmail: (input.supportEmail || existing.supportEmail || "info@podhyperush.com").trim(),
  };

  if (!next.appUrl) throw new Error("appUrl is required");
  if (!next.googleClientId || !next.googleClientSecret)
    throw new Error("Google credentials are required");

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), "utf8");
  cached = next;
  return cached;
}

export function updatePartial(patch) {
  const existing = loadConfig() || {};
  return saveConfig({ ...existing, ...patch });
}
