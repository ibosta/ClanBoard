import express from "express";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import { loadConfig, saveConfig, isSetupComplete } from "./config.js";
import { runMigrations, query, pool } from "./db.js";
import {
  readSession,
  writeSession,
  clearSession,
  currentUser,
  googleAuthUrl,
  googleExchange,
  loginOrCreateFromGoogle,
} from "./auth.js";
import { githubAuthUrl, githubExchange, ghFetch, encrypt } from "./github.js";
import { attachWs } from "./ws.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "3000", 10);
const PUBLIC_DIR = path.join(__dirname, "public");
const FRONTEND_DIR = path.join(__dirname, "frontend");

loadConfig();

const app = express();
if (process.env.TRUST_PROXY === "true") app.set("trust proxy", true);
app.use(express.json({ limit: "2mb" }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    console.log(`[req] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

// cookie parser
app.use((req, _res, next) => {
  const raw = req.headers.cookie || "";
  req.cookies = Object.fromEntries(
    raw
      .split(";")
      .filter(Boolean)
      .map((c) => {
        const i = c.indexOf("=");
        return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1))];
      }),
  );
  next();
});

// ---------- SETUP WIZARD ----------

function setupGuard(req, res, next) {
  const complete = isSetupComplete();
  if (req.path === "/setup" || req.path.startsWith("/setup/") || req.path.startsWith("/api/setup")) {
    if (complete) {
      if (req.path.startsWith("/api/")) {
        return res.status(403).json({ error: "setup_already_complete" });
      }
      return res.redirect("/");
    }
    return next();
  }
  if (!complete) {
    if (req.path.startsWith("/api/")) return res.status(503).json({ error: "setup_required" });
    return res.redirect("/setup");
  }
  next();
}
app.use(setupGuard);

app.get("/setup", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "setup.html"));
});

app.get("/api/setup/status", (req, res) => {
  const cfg = loadConfig();
  res.json({
    complete: isSetupComplete(),
    appUrl: cfg?.appUrl || `${req.protocol}://${req.get("host")}`,
    brand: cfg?.brand || "Hyperush",
    supportEmail: cfg?.supportEmail || "info@podhyperush.com",
  });
});

app.post("/api/setup/save", async (req, res) => {
  try {
    if (isSetupComplete()) {
      const u = await currentUser(req);
      if (!u || u.role !== "admin") return res.status(403).json({ error: "forbidden" });
    }
    const cfg = saveConfig(req.body || {});
    res.json({ ok: true, appUrl: cfg.appUrl });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- AUTH ROUTES ----------

app.get("/api/auth/google/start", (_req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  res.setHeader(
    "Set-Cookie",
    `oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`,
  );
  res.redirect(googleAuthUrl(state));
});

app.get("/api/auth/google/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state || state !== req.cookies.oauth_state)
      return res.status(400).send("Invalid state");
    const profile = await googleExchange(code);
    const user = await loginOrCreateFromGoogle(profile);
    writeSession(res, { uid: user.id });
    res.redirect("/board");
  } catch (err) {
    console.error("[google callback]", err);
    res.status(500).send("Login failed: " + err.message);
  }
});

app.post("/api/auth/logout", (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

app.get("/api/me", async (req, res) => {
  const u = await currentUser(req);
  if (!u) return res.status(401).json({ error: "unauthorized" });
  res.json(u);
});

// Middleware
async function requireAuth(req, res, next) {
  const u = await currentUser(req);
  if (!u) return res.status(401).json({ error: "unauthorized" });
  req.user = u;
  next();
}
async function requireApproved(req, res, next) {
  if (!req.user.approved) return res.status(403).json({ error: "pending_approval" });
  next();
}
function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "admin_only" });
  next();
}

// ---------- GITHUB OAUTH ----------

app.get("/api/auth/github/start", requireAuth, requireApproved, (_req, res) => {
  const cfg = loadConfig();
  if (!cfg.githubClientId) return res.status(400).send("GitHub not configured");
  const state = crypto.randomBytes(16).toString("hex");
  res.setHeader(
    "Set-Cookie",
    `gh_state=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`,
  );
  res.redirect(githubAuthUrl(state));
});

app.get("/api/auth/github/callback", requireAuth, requireApproved, async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || state !== req.cookies.gh_state) return res.status(400).send("Invalid state");
    const tokens = await githubExchange(code);
    const meRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: "application/vnd.github+json" },
    });
    const gh = await meRes.json();
    await query(
      `INSERT INTO github_connections(user_id, github_login, github_id, github_avatar_url,
         access_token_ciphertext, scope)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id) DO UPDATE SET github_login=EXCLUDED.github_login,
         github_id=EXCLUDED.github_id,
         github_avatar_url=EXCLUDED.github_avatar_url,
         access_token_ciphertext=EXCLUDED.access_token_ciphertext,
         scope=EXCLUDED.scope,
         updated_at=now()`,
      [req.user.id, gh.login, gh.id, gh.avatar_url || null, encrypt(tokens.access_token), tokens.scope || null],
    );
    res.redirect("/board?github=connected");
  } catch (err) {
    console.error("[gh callback]", err);
    res.redirect("/board?github=error&reason=" + encodeURIComponent(err.message || "failed"));
  }
});

app.post("/api/github/disconnect", requireAuth, requireApproved, async (req, res) => {
  await query("DELETE FROM github_connections WHERE user_id = $1", [req.user.id]);
  res.json({ ok: true });
});

// ---------- API: USERS / ADMIN ----------

app.get("/api/users", requireAuth, requireApproved, async (_req, res) => {
  const r = await query(
    `SELECT id, email, full_name, avatar_url, role, approved
     FROM users WHERE approved = TRUE ORDER BY full_name`,
  );
  res.json(r.rows);
});

app.get("/api/admin/users", requireAuth, requireAdmin, async (_req, res) => {
  const r = await query(
    `SELECT id, email, full_name, avatar_url, role, approved, can_announce, approved_at, approved_by, created_at
     FROM users ORDER BY created_at DESC`,
  );
  res.json(r.rows);
});

app.post("/api/admin/users/:id/approve", requireAuth, requireAdmin, async (req, res) => {
  await query(
    "UPDATE users SET approved = TRUE, approved_at = now(), approved_by = $1 WHERE id = $2",
    [req.user.id, req.params.id],
  );
  
  await query(
    `INSERT INTO notifications (user_id, title, content, type)
     VALUES ($1, 'Hesabınız Onaylandı', 'ClanBoard hesabınız yönetici tarafından onaylandı. Artık panoya tam erişim sağlayabilirsiniz!', 'task')`,
    [req.params.id]
  ).catch(console.error);

  res.json({ ok: true });
});

app.post("/api/admin/users/:id/revoke", requireAuth, requireAdmin, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: "cannot_revoke_self" });
  await query(
    "UPDATE users SET approved = FALSE, approved_at = NULL, approved_by = NULL WHERE id = $1",
    [req.params.id],
  );
  res.json({ ok: true });
});

app.post("/api/admin/users/:id/role", requireAuth, requireAdmin, async (req, res) => {
  const { role } = req.body;
  if (!["admin", "member"].includes(role)) return res.status(400).json({ error: "bad_role" });
  
  // Update role and set can_announce automatically if admin
  const canAnnounce = role === "admin";
  await query("UPDATE users SET role = $1, can_announce = $2 WHERE id = $3", [role, canAnnounce, req.params.id]);
  res.json({ ok: true });
});

app.post("/api/admin/users/:id/permissions", requireAuth, requireAdmin, async (req, res) => {
  const { role, can_announce } = req.body || {};
  if (role && !["admin", "member"].includes(role)) return res.status(400).json({ error: "bad_role" });
  
  const sets = [];
  const vals = [];
  
  if (role !== undefined) {
    vals.push(role);
    sets.push(`role = $${vals.length}`);
  }
  if (can_announce !== undefined) {
    vals.push(!!can_announce);
    sets.push(`can_announce = $${vals.length}`);
  }
  
  if (!sets.length) return res.json({ ok: true });
  vals.push(req.params.id);
  await query(`UPDATE users SET ${sets.join(", ")}, updated_at = now() WHERE id = $${vals.length}`, vals);
  res.json({ ok: true });
});

app.delete("/api/admin/users/:id", requireAuth, requireAdmin, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: "cannot_delete_self" });
  
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE users SET approved_by = NULL WHERE approved_by = $1", [req.params.id]);
    await client.query("DELETE FROM users WHERE id = $1", [req.params.id]);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[delete user error]", err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ---------- API: TASKS ----------

const TASK_COLS = `id, title, description, status, priority, category, assignee_ids, created_by,
  due_date, tags, repo_full_name, branch, issue_number, position, deleted_at,
  created_at, updated_at`;

app.get("/api/tasks", requireAuth, requireApproved, async (req, res) => {
  const trash = req.query.trash === "1";
  const r = await query(
    `SELECT ${TASK_COLS} FROM tasks WHERE deleted_at IS ${trash ? "NOT" : ""} NULL
     ORDER BY ${trash ? "deleted_at DESC" : "position ASC, created_at ASC"}`,
  );
  res.json(r.rows);
});

app.post("/api/tasks", requireAuth, requireApproved, async (req, res) => {
  const b = req.body || {};
  const r = await query(
    `INSERT INTO tasks(title, description, status, priority, category, assignee_ids, created_by,
       due_date, tags, repo_full_name, branch, issue_number)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${TASK_COLS}`,
    [
      b.title || "Yeni görev",
      b.description || null,
      b.status || "todo",
      b.priority || "medium",
      b.category || "feature",
      Array.isArray(b.assignee_ids) ? b.assignee_ids : [],
      b.created_by || req.user.id,
      b.due_date || null,
      Array.isArray(b.tags) ? b.tags : [],
      b.repo_full_name || null,
      b.branch || null,
      b.issue_number || null,
    ],
  );
  const newTask = r.rows[0];
  if (newTask && Array.isArray(newTask.assignee_ids)) {
    const creatorName = req.user.full_name || req.user.email || "Bir kullanıcı";
    for (const uid of newTask.assignee_ids) {
      if (uid !== req.user.id) {
        await query(
          `INSERT INTO notifications(user_id, title, content, type, task_id)
           VALUES ($1, $2, $3, 'task', $4)`,
          [
            uid,
            "Yeni Görev Atandı",
            `${creatorName} size bir görev atadı: "${newTask.title}"`,
            newTask.id
          ]
        ).catch(console.error);
      }
    }
  }
  res.json(newTask);
});

app.patch("/api/tasks/:id", requireAuth, requireApproved, async (req, res) => {
  const b = req.body || {};
  const fields = [
    "title", "description", "status", "priority", "category", "assignee_ids",
    "due_date", "tags", "repo_full_name", "branch", "issue_number", "position",
    "deleted_at",
  ];
  const oldTask = await query("SELECT assignee_ids FROM tasks WHERE id = $1", [req.params.id]).catch(() => null);
  const prevAssigneeIds = oldTask && oldTask.rowCount > 0 ? (oldTask.rows[0].assignee_ids || []) : [];

  const sets = [];
  const vals = [];
  for (const f of fields) {
    if (f in b) {
      vals.push(b[f]);
      sets.push(`${f} = $${vals.length}`);
    }
  }
  if (!sets.length) return res.json({ ok: true });
  vals.push(req.params.id);
  const r = await query(
    `UPDATE tasks SET ${sets.join(", ")}, updated_at = now()
     WHERE id = $${vals.length} RETURNING ${TASK_COLS}`,
    vals,
  );
  const updatedTask = r.rows[0];
  if (updatedTask && Array.isArray(updatedTask.assignee_ids)) {
    const newAssignees = updatedTask.assignee_ids;
    const addedAssignees = newAssignees.filter(id => !prevAssigneeIds.includes(id));
    
    if (addedAssignees.length > 0) {
      const updaterName = req.user.full_name || req.user.email || "Bir kullanıcı";
      for (const uid of addedAssignees) {
        if (uid !== req.user.id) {
          await query(
            `INSERT INTO notifications(user_id, title, content, type, task_id)
             VALUES ($1, $2, $3, 'task', $4)`,
            [
              uid,
              "Görev Atandı",
              `${updaterName} size bir görev atadı: "${updatedTask.title}"`,
              updatedTask.id
            ]
          ).catch(console.error);
        }
      }
    }
  }
  res.json(updatedTask);
});

app.delete("/api/tasks/:id", requireAuth, requireApproved, async (req, res) => {
  // Hard delete only through /purge — soft delete uses PATCH deleted_at.
  const r = await query("DELETE FROM tasks WHERE id = $1 RETURNING id", [req.params.id]);
  if (!r.rowCount) return res.status(404).json({ error: "not_found" });
  res.json({ ok: true });
});

// ---------- API: COMMENTS ----------

app.get("/api/tasks/:id/comments", requireAuth, requireApproved, async (req, res) => {
  const r = await query(
    `SELECT c.*,
       COALESCE(
         (SELECT json_agg(json_build_object('user_id', user_id, 'emoji', emoji))
          FROM comment_reactions
          WHERE comment_id = c.id),
         '[]'::json
       ) AS reactions
     FROM task_comments c
     WHERE c.task_id = $1
     ORDER BY c.created_at ASC`,
    [req.params.id],
  );
  res.json(r.rows);
});

app.post("/api/tasks/:id/comments", requireAuth, requireApproved, async (req, res) => {
  const { content, type, parent_id, author_id } = req.body || {};
  if (!content) return res.status(400).json({ error: "content_required" });
  const r = await query(
    `INSERT INTO task_comments(task_id, author_id, parent_id, content, type)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.params.id, author_id || req.user.id, parent_id || null, content, type || "note"],
  );
  
  const newComment = r.rows[0];
  try {
    const taskResult = await query("SELECT title, assignee_ids FROM tasks WHERE id = $1", [req.params.id]);
    if (taskResult.rowCount > 0) {
      const task = taskResult.rows[0];
      const commentatorName = req.user.full_name || req.user.email || "Bir kullanıcı";
      
      const toNotify = new Set();
      
      if (Array.isArray(task.assignee_ids)) {
        for (const aid of task.assignee_ids) {
          if (aid && aid !== req.user.id) {
            toNotify.add(aid);
          }
        }
      }
      
      if (parent_id) {
        const parentComment = await query("SELECT author_id FROM task_comments WHERE id = $1", [parent_id]);
        if (parentComment.rowCount > 0) {
          const parentAuthorId = parentComment.rows[0].author_id;
          if (parentAuthorId && parentAuthorId !== req.user.id) {
            toNotify.add(parentAuthorId);
          }
        }
      }
      
      const usersListResult = await query("SELECT id, full_name, email FROM users WHERE approved = true");
      const usersList = usersListResult.rows;
      
      const mentionedIds = [];
      
      function turkishToEnglish(str) {
        if (!str) return "";
        return str
          .replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
          .replace(/ü/g, 'u').replace(/Ü/g, 'U')
          .replace(/ş/g, 's').replace(/Ş/g, 'S')
          .replace(/ı/g, 'i').replace(/İ/g, 'I')
          .replace(/ö/g, 'o').replace(/Ö/g, 'O')
          .replace(/ç/g, 'c').replace(/Ç/g, 'C');
      }

      const normalizedContent = turkishToEnglish(content).toLowerCase();
      for (const u of usersList) {
        if (u.id === req.user.id) continue;
        
        const rawNameSlug = u.full_name ? u.full_name.replace(/\s+/g, "") : "";
        const nameSlug = turkishToEnglish(rawNameSlug).toLowerCase();
        const emailPrefix = u.email ? u.email.split("@")[0].toLowerCase() : "";
        
        const patterns = [];
        if (nameSlug) patterns.push(`@${nameSlug}`);
        if (emailPrefix) patterns.push(`@${emailPrefix}`);
        
        for (const p of patterns) {
          const regex = new RegExp(`(?:^|\\s)${p}(?:$|\\s|[^a-zA-Z0-9_])`, "i");
          if (regex.test(normalizedContent)) {
            mentionedIds.push(u.id);
            toNotify.add(u.id);
            break;
          }
        }
      }
      
      for (const userId of toNotify) {
        const isMentioned = mentionedIds.includes(userId);
        const title = isMentioned ? "Bir Yorumda Bahsedildiniz" : `Yeni Yorum: ${task.title}`;
        const notificationContent = isMentioned
          ? `${commentatorName} size "${task.title}" görevindeki bir yorumda değindi: "${content.slice(0, 80)}"`
          : `${commentatorName} bir yorum yazdı: "${content.slice(0, 80)}${content.length > 80 ? '...' : ''}"`;
          
        await query(
          `INSERT INTO notifications(user_id, title, content, type, task_id, comment_id)
           VALUES ($1, $2, $3, 'comment', $4, $5)`,
          [userId, title, notificationContent, req.params.id, newComment.id]
        );
      }
    }
  } catch (err) {
    console.error("[comment notify error]", err);
  }
  
  res.json(newComment);
});

app.delete("/api/comments/:id", requireAuth, requireApproved, async (req, res) => {
  console.log("[comment delete] id:", req.params.id, "user:", req.user.id, "role:", req.user.role);
  const r = await query("SELECT author_id FROM task_comments WHERE id = $1", [req.params.id]);
  console.log("[comment delete] query rowCount:", r.rowCount, "rows:", r.rows);
  if (!r.rowCount) return res.status(404).json({ error: "not_found" });
  if (r.rows[0].author_id !== req.user.id && req.user.role !== "admin")
    return res.status(403).json({ error: "forbidden" });
  await query("DELETE FROM task_comments WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

app.post("/api/comments/:commentId/reactions", requireAuth, requireApproved, async (req, res) => {
  const commentId = req.params.commentId;
  const emoji = req.body.emoji;
  const userId = req.user.id;
  if (!emoji) return res.status(400).json({ error: "emoji_required" });

  try {
    const check = await query(
      "SELECT id FROM comment_reactions WHERE comment_id = $1 AND user_id = $2 AND emoji = $3",
      [commentId, userId, emoji]
    );

    if (check.rowCount > 0) {
      await query(
        "DELETE FROM comment_reactions WHERE comment_id = $1 AND user_id = $2 AND emoji = $3",
        [commentId, userId, emoji]
      );
      return res.json({ toggled: "removed" });
    } else {
      const r = await query(
        "INSERT INTO comment_reactions(comment_id, user_id, emoji) VALUES ($1, $2, $3) RETURNING *",
        [commentId, userId, emoji]
      );
      
      const commentRes = await query("SELECT author_id, task_id, content FROM task_comments WHERE id = $1", [commentId]);
      if (commentRes.rowCount > 0) {
        const comment = commentRes.rows[0];
        const commentatorId = comment.author_id;
        if (commentatorId && commentatorId !== userId) {
          const reactorName = req.user.full_name || req.user.email || "Bir kullanıcı";
          await query(
            `INSERT INTO notifications(user_id, title, content, type, task_id, comment_id)
             VALUES ($1, $2, $3, 'comment', $4, $5)`,
            [
              commentatorId,
              "Yorumuna Tepki Bırakıldı",
              `${reactorName} yorumuna ${emoji} tepkisini bıraktı: "${comment.content.slice(0, 50)}"`,
              comment.task_id,
              commentId
            ]
          ).catch(console.error);
        }
      }
      return res.json({ toggled: "added", reaction: r.rows[0] });
    }
  } catch (err) {
    console.error("[reaction error]", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- API: NOTIFICATIONS ----------

app.get("/api/notifications", requireAuth, requireApproved, async (req, res) => {
  try {
    const r = await query(
      `SELECT * FROM notifications 
       WHERE user_id = $1 
       ORDER BY read ASC, created_at DESC 
       LIMIT 50`,
      [req.user.id]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/notifications/:id", requireAuth, requireApproved, async (req, res) => {
  const { read } = req.body || {};
  if (typeof read !== "boolean") return res.status(400).json({ error: "read_required" });
  try {
    const r = await query(
      `UPDATE notifications 
       SET read = $1 
       WHERE id = $2 AND user_id = $3 
       RETURNING *`,
      [read, req.params.id, req.user.id]
    );
    if (!r.rowCount) return res.status(404).json({ error: "not_found" });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/notifications/read-announcements", requireAuth, requireApproved, async (req, res) => {
  try {
    await query(
      `UPDATE notifications 
       SET read = true 
       WHERE user_id = $1 AND type = 'announcement' AND read = false`,
      [req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/announcements", requireAuth, requireAdmin, async (req, res) => {
  const { title, content } = req.body || {};
  if (!title || !content) return res.status(400).json({ error: "title_and_content_required" });
  try {
    const r = await query(
      `INSERT INTO notifications (user_id, title, content, type)
       SELECT id, $1, $2, 'announcement'
       FROM users
       WHERE approved = true AND id != $3
       RETURNING id`,
      [title, content, req.user.id]
    );
    res.json({ ok: true, count: r.rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- API: GITHUB REPOS / COMMITS ----------

app.get("/api/github/status", requireAuth, requireApproved, async (req, res) => {
  const r = await query(
    "SELECT github_login, github_avatar_url, scope, updated_at FROM github_connections WHERE user_id = $1",
    [req.user.id],
  );
  if (!r.rowCount) return res.json({ connected: false });
  res.json({ connected: true, ...r.rows[0] });
});

app.get("/api/github/repos", requireAuth, requireApproved, async (req, res) => {
  try {
    const resp = await ghFetch(
      req.user.id,
      "/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member",
    );
    if (!resp.ok) return res.status(resp.status).send(await resp.text());
    const data = await resp.json();
    res.json(
      data.map((r) => ({
        full_name: r.full_name,
        private: r.private,
        description: r.description,
        pushed_at: r.pushed_at,
      })),
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/github/branches", requireAuth, requireApproved, async (req, res) => {
  const { repo } = req.query;
  if (!repo) return res.status(400).json({ error: "repo_required" });
  try {
    const resp = await ghFetch(req.user.id, `/repos/${repo}/branches?per_page=100`);
    if (!resp.ok) return res.status(resp.status).send(await resp.text());
    const data = await resp.json();
    res.json(data.map((b) => b.name));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/github/commits", requireAuth, requireApproved, async (req, res) => {
  const { repo } = req.query;
  if (!repo) return res.status(400).json({ error: "repo_required" });
  try {
    const resp = await ghFetch(req.user.id, `/repos/${repo}/commits?per_page=30`);
    if (!resp.ok) return res.status(resp.status).send(await resp.text());
    const rows = await resp.json();
    res.json(
      rows.map((c) => ({
        sha: c.sha,
        short_sha: c.sha.slice(0, 7),
        message: c.commit.message,
        html_url: c.html_url,
        author_name: c.commit.author?.name ?? null,
        author_login: c.author?.login ?? null,
        author_avatar_url: c.author?.avatar_url ?? null,
        committed_at: c.commit.author?.date ?? null,
      })),
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tasks/:id/commits", requireAuth, requireApproved, async (req, res) => {
  const r = await query(
    "SELECT * FROM task_commits WHERE task_id = $1 ORDER BY committed_at DESC",
    [req.params.id],
  );
  res.json(r.rows);
});

app.delete("/api/commits/:id", requireAuth, requireApproved, async (req, res) => {
  await query("DELETE FROM task_commits WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

app.post("/api/tasks/:id/commits/attach", requireAuth, requireApproved, async (req, res) => {
  const { repo_full_name, sha } = req.body || {};
  if (!repo_full_name || !sha) return res.status(400).json({ error: "repo_and_sha_required" });
  try {
    const resp = await ghFetch(req.user.id, `/repos/${repo_full_name}/commits/${sha}`);
    if (!resp.ok) return res.status(resp.status).send(await resp.text());
    const c = await resp.json();
    await query(
      `INSERT INTO task_commits(task_id, repo_full_name, sha, short_sha, message, author_name,
         author_login, author_avatar_url, html_url, committed_at, added_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (task_id, sha) DO NOTHING`,
      [
        req.params.id,
        repo_full_name,
        c.sha,
        c.sha.slice(0, 7),
        (c.commit.message || "").split("\n")[0].slice(0, 200),
        c.commit.author?.name || null,
        c.author?.login || null,
        c.author?.avatar_url || null,
        c.html_url,
        c.commit.author?.date || new Date().toISOString(),
        req.user.id,
      ],
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/tasks/:id/commits/sync", requireAuth, requireApproved, async (req, res) => {
  try {
    const t = await query("SELECT repo_full_name, branch FROM tasks WHERE id = $1", [req.params.id]);
    if (!t.rowCount) return res.status(404).json({ error: "task_not_found" });
    const bodyRepo = req.body?.repo_full_name;
    const bodyBranch = req.body?.branch;
    const repo_full_name = bodyRepo || t.rows[0].repo_full_name;
    const branch = bodyBranch !== undefined ? bodyBranch : t.rows[0].branch;
    if (!repo_full_name) return res.json({ inserted: 0, total: 0 });
    const q = new URLSearchParams({ per_page: "30" });
    if (branch) q.set("sha", branch);
    const resp = await ghFetch(req.user.id, `/repos/${repo_full_name}/commits?${q}`);
    if (!resp.ok) return res.status(resp.status).send(await resp.text());
    const commits = await resp.json();
    let n = 0;
    for (const c of commits) {
      const r = await query(
        `INSERT INTO task_commits(task_id, repo_full_name, sha, short_sha, message, author_name,
           author_login, author_avatar_url, html_url, committed_at, branch, added_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (task_id, sha) DO NOTHING`,
        [
          req.params.id,
          repo_full_name,
          c.sha,
          c.sha.slice(0, 7),
          (c.commit.message || "").split("\n")[0].slice(0, 200),
          c.commit.author?.name || null,
          c.author?.login || null,
          c.author?.avatar_url || null,
          c.html_url,
          c.commit.author?.date || new Date().toISOString(),
          branch || null,
          req.user.id,
        ],
      );
      if (r.rowCount) n++;
    }
    res.json({ inserted: n, total: commits.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- STATIC FRONTEND ----------

if (fs.existsSync(FRONTEND_DIR)) {
  app.use(express.static(FRONTEND_DIR));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(FRONTEND_DIR, "index.html"));
  });
} else {
  app.get("/", (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "placeholder.html"));
  });
}

// ---------- BOOT ----------

const server = http.createServer(app);
attachWs(server);

runMigrations()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`[hyperush] listening on :${PORT}`);
      if (!isSetupComplete())
        console.log(`[hyperush] setup wizard: http://localhost:${PORT}/setup`);
    });
  })
  .catch((err) => {
    console.error("[fatal] migrations failed:", err);
    process.exit(1);
  });
