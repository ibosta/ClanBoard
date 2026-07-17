// Standalone Docker build: this file talks to the local Express backend at
// /api/* + WebSocket at /ws. It preserves the small subset of the Supabase
// client surface that the app actually uses (`.auth.*`, `.from(...).*`,
// `.channel(...).on(...).subscribe()`, `.removeChannel(...)`).
//
// Not a general-purpose shim — only patterns present in this codebase.

type Row = Record<string, any>;
type OrderSpec = { col: string; asc: boolean };
type FilterSpec = { col: string; op: "eq" | "is" | "not-is" | "in"; val: any };

type Result<T> = { data: T | null; error: { message: string } | null };

async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const r = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  if (!r.ok) {
    const contentType = r.headers.get("content-type") || "";
    let msg = "";
    if (contentType.includes("html") || r.status === 502) {
      msg = `Sunucuya bağlanılamadı (Hata ${r.status}). Lütfen internet bağlantınızı kontrol edin veya birkaç saniye sonra tekrar deneyin.`;
    } else {
      const text = await r.text().catch(() => "");
      msg = text || r.statusText;
      try {
        const j = JSON.parse(text);
        if (j?.error) msg = j.error;
      } catch {}
    }
    // Truncate message if it is abnormally long
    if (msg.length > 150) {
      msg = msg.slice(0, 150) + "...";
    }
    throw new Error(msg);
  }
  if (r.status === 204) return null as unknown as T;
  return r.json() as Promise<T>;
}

// ---------- REST routing per table + filter combo ----------

class QueryBuilder implements PromiseLike<Result<any>> {
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private values: any = null;
  private filters: FilterSpec[] = [];
  private orders: OrderSpec[] = [];
  private wantSingle = false;

  constructor(private table: string) {}

  select(_cols?: string) { this.op = "select"; return this; }
  insert(v: any) { this.op = "insert"; this.values = v; return this; }
  update(v: any) { this.op = "update"; this.values = v; return this; }
  upsert(v: any, _opts?: any) { this.op = "upsert"; this.values = v; return this; }
  delete() { this.op = "delete"; return this; }
  eq(col: string, val: any) { this.filters.push({ col, op: "eq", val }); return this; }
  is(col: string, val: any) { this.filters.push({ col, op: "is", val }); return this; }
  not(col: string, op: string, val: any) {
    if (op === "is") this.filters.push({ col, op: "not-is", val });
    return this;
  }
  in(col: string, val: any[]) { this.filters.push({ col, op: "in", val }); return this; }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orders.push({ col, asc: opts?.ascending !== false });
    return this;
  }
  maybeSingle() { this.wantSingle = true; return this.exec(); }
  single() { this.wantSingle = true; return this.exec(); }

  then<A, B>(
    onOk?: (v: Result<any>) => A | PromiseLike<A>,
    onErr?: (e: any) => B | PromiseLike<B>,
  ) {
    return this.exec().then(onOk, onErr);
  }

  private eqVal(col: string) {
    return this.filters.find((f) => f.op === "eq" && f.col === col)?.val;
  }

  private async exec(): Promise<Result<any>> {
    try {
      const data = await this.dispatch();
      if (this.wantSingle) {
        const one = Array.isArray(data) ? (data[0] ?? null) : data ?? null;
        return { data: one, error: null };
      }
      return { data, error: null };
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
    }
  }

  private async dispatch(): Promise<any> {
    const t = this.table;

    // ---- profiles (mapped to /api/users or /api/admin/users or /api/me) ----
    if (t === "profiles") {
      if (this.op === "select") {
        const id = this.eqVal("id");
        if (id) {
          const me = await apiFetch<Row>("/api/me").catch(() => null);
          if (me && me.id === id) return this.wantSingle ? me : [me];
          // Fallback: pick from admin list if allowed, else null
          try {
            const list = await apiFetch<Row[]>("/api/admin/users");
            const one = list.find((u) => u.id === id) || null;
            return this.wantSingle ? one : (one ? [one] : []);
          } catch {
            return this.wantSingle ? null : [];
          }
        }
        // Admin listing when ordering by created_at
        if (this.orders.some((o) => o.col === "created_at")) {
          return apiFetch<Row[]>("/api/admin/users");
        }
        return apiFetch<Row[]>("/api/users");
      }
      if (this.op === "upsert") {
        // Server auto-creates the profile on Google login — nothing to do.
        return null;
      }
      if (this.op === "update") {
        const id = this.eqVal("id");
        if (!id) throw new Error("profiles.update requires eq('id', ...)");
        const approved = this.values?.approved;
        const role = this.values?.role;
        const can_announce = this.values?.can_announce;
        
        if (typeof approved === "boolean" && role === undefined && can_announce === undefined) {
          await apiFetch(`/api/admin/users/${id}/${approved ? "approve" : "revoke"}`, { method: "POST" });
          return null;
        }
        
        if (role !== undefined || can_announce !== undefined) {
          await apiFetch(`/api/admin/users/${id}/permissions`, {
            method: "POST",
            body: JSON.stringify({ role, can_announce }),
          });
          return null;
        }
        
        throw new Error("Unsupported profiles.update fields");
      }
      if (this.op === "delete") {
        const id = this.eqVal("id");
        if (!id) throw new Error("profiles.delete requires eq('id', ...)");
        await apiFetch(`/api/admin/users/${id}`, { method: "DELETE" });
        return null;
      }
    }

    // ---- user_roles (frontend uses .from('user_roles').select('role').eq('user_id',uid).eq('role','admin').maybeSingle()) ----
    if (t === "user_roles") {
      const me = await apiFetch<Row>("/api/me").catch(() => null);
      if (!me) return this.wantSingle ? null : [];
      const wantRole = this.filters.find((f) => f.col === "role")?.val;
      if (wantRole && me.role !== wantRole) return this.wantSingle ? null : [];
      const row = { role: me.role, user_id: me.id };
      return this.wantSingle ? row : [row];
    }

    // ---- tasks ----
    if (t === "tasks") {
      if (this.op === "select") {
        const wantsTrash = this.filters.some(
          (f) => f.col === "deleted_at" && f.op === "not-is" && f.val === null,
        );
        return apiFetch<Row[]>(`/api/tasks${wantsTrash ? "?trash=1" : ""}`);
      }
      if (this.op === "insert") {
        const v = Array.isArray(this.values) ? this.values[0] : this.values;
        return apiFetch<Row>("/api/tasks", { method: "POST", body: JSON.stringify(v) });
      }
      if (this.op === "update") {
        const id = this.eqVal("id");
        if (!id) throw new Error("tasks.update requires eq('id', ...)");
        return apiFetch<Row>(`/api/tasks/${id}`, {
          method: "PATCH",
          body: JSON.stringify(this.values),
        });
      }
      if (this.op === "delete") {
        const id = this.eqVal("id");
        if (!id) throw new Error("tasks.delete requires eq('id', ...)");
        return apiFetch(`/api/tasks/${id}`, { method: "DELETE" });
      }
    }

    // ---- task_comments ----
    if (t === "task_comments") {
      const taskId = this.eqVal("task_id");
      if (this.op === "select") {
        if (!taskId) throw new Error("task_comments select requires task_id filter");
        return apiFetch<Row[]>(`/api/tasks/${taskId}/comments`);
      }
      if (this.op === "insert") {
        const v = Array.isArray(this.values) ? this.values[0] : this.values;
        return apiFetch<Row>(`/api/tasks/${v.task_id}/comments`, {
          method: "POST",
          body: JSON.stringify(v),
        });
      }
      if (this.op === "delete") {
        const id = this.eqVal("id");
        if (!id) throw new Error("task_comments.delete requires eq('id', ...)");
        return apiFetch(`/api/comments/${id}`, { method: "DELETE" });
      }
    }

    // ---- task_commits ----
    if (t === "task_commits") {
      const taskId = this.eqVal("task_id");
      if (this.op === "select") {
        if (!taskId) throw new Error("task_commits select requires task_id filter");
        return apiFetch<Row[]>(`/api/tasks/${taskId}/commits`);
      }
      if (this.op === "delete") {
        const id = this.eqVal("id");
        if (!id) throw new Error("task_commits.delete requires eq('id', ...)");
        return apiFetch(`/api/commits/${id}`, { method: "DELETE" });
      }
    }
    // ---- notifications ----
    if (t === "notifications") {
      if (this.op === "select") {
        return apiFetch<Row[]>("/api/notifications");
      }
      if (this.op === "update") {
        const id = this.eqVal("id");
        if (!id) throw new Error("notifications.update requires eq('id', ...)");
        return apiFetch<Row>(`/api/notifications/${id}`, {
          method: "PATCH",
          body: JSON.stringify(this.values),
        });
      }
    }

    throw new Error(`Unsupported query: ${this.op} on ${this.table}`);
  }
}

// ---------- Realtime channel shim ----------

type ChangeHandler = (payload: {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: Row;
  old: Row;
  schema: string;
  table: string;
}) => void;

interface ChannelSub {
  table: string;
  filter?: { col: string; val: string };
  handler: ChangeHandler;
}

class Channel {
  private subs: ChannelSub[] = [];
  constructor(private name: string) {}
  on(_event: string, cfg: { event?: string; schema?: string; table: string; filter?: string }, handler: ChangeHandler) {
    let filter: ChannelSub["filter"];
    if (cfg.filter) {
      // Only "col=eq.value" is used in the app
      const m = /^([\w.]+)=eq\.(.+)$/.exec(cfg.filter);
      if (m) filter = { col: m[1], val: m[2] };
    }
    this.subs.push({ table: cfg.table, filter, handler });
    return this;
  }
  subscribe() {
    channels.add(this);
    ensureWs();
    return this;
  }
  dispatch(msg: { table: string; op: string; row: Row }) {
    for (const s of this.subs) {
      if (s.table !== msg.table) continue;
      if (s.filter && String(msg.row?.[s.filter.col]) !== String(s.filter.val)) continue;
      const eventType = msg.op as "INSERT" | "UPDATE" | "DELETE";
      s.handler({ eventType, new: msg.row, old: msg.row, schema: "public", table: msg.table });
    }
  }
  destroy() { channels.delete(this); }
}

const channels = new Set<Channel>();
let ws: WebSocket | null = null;
let wsRetryTimer: ReturnType<typeof setTimeout> | null = null;

function ensureWs() {
  if (typeof window === "undefined") return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${window.location.host}/ws`);
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (!msg?.table) return;
      for (const ch of channels) ch.dispatch(msg);
    } catch {}
  };
  ws.onclose = () => {
    if (wsRetryTimer) clearTimeout(wsRetryTimer);
    wsRetryTimer = setTimeout(ensureWs, 2000);
  };
  ws.onerror = () => { try { ws?.close(); } catch {} };
}

// ---------- Auth shim ----------

type AuthChangeListener = (event: string, session: any) => void;
const authListeners = new Set<AuthChangeListener>();

async function fetchMe(): Promise<Row | null> {
  try { return await apiFetch<Row>("/api/me"); } catch { return null; }
}

function meToUser(me: Row) {
  return {
    id: me.id,
    email: me.email,
    user_metadata: { full_name: me.full_name, avatar_url: me.avatar_url },
    app_metadata: { role: me.role },
  };
}

export const supabase = {
  from(table: string) { return new QueryBuilder(table); },

  channel(name: string) { return new Channel(name); },

  removeChannel(ch: Channel) { ch.destroy(); },

  auth: {
    async getUser() {
      const me = await fetchMe();
      if (!me) return { data: { user: null }, error: { message: "unauthorized" } };
      return { data: { user: meToUser(me) }, error: null };
    },
    async getSession() {
      const me = await fetchMe();
      if (!me) return { data: { session: null }, error: null };
      return { data: { session: { user: meToUser(me), access_token: "cookie" } }, error: null };
    },
    async signOut() {
      await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
      for (const l of authListeners) l("SIGNED_OUT", null);
      return { error: null };
    },
    async setSession(_tokens?: any) {
      // Cookies are set by the server on OAuth callback — nothing to persist client-side.
      const me = await fetchMe();
      return { data: { session: me ? { user: meToUser(me) } : null, user: me ? meToUser(me) : null }, error: null };
    },
    onAuthStateChange(listener: AuthChangeListener) {
      authListeners.add(listener);
      const unsubscribe = () => { authListeners.delete(listener); };
      return { data: { subscription: { unsubscribe } } };
    },
    // Password auth is not supported in the standalone backend; kept as no-ops
    // that surface a clear error so any leftover call fails loudly.
    async signInWithPassword(_creds?: any) {
      return { data: null, error: { message: "Şifreyle giriş desteklenmiyor — Google ile giriş yap." } };
    },
    async signUp(_creds?: any) {
      return { data: null, error: { message: "Kayıt yalnızca Google ile — /api/auth/google/start" } };
    },
  },
};

export type SupabaseClient = typeof supabase;
