# Frontend'i Bu Backend'e Bağlama

Mevcut React (TanStack Start) frontend'i `@supabase/supabase-js` kullanıyor.
Standalone Docker sürümünde bunun yerine bu backend'in REST + WebSocket
API'sini kullanması gerekir.

## Yapılacak değişikliklerin özeti

### 1. Supabase client'ı yerine ince API katmanı

`src/lib/api.ts` (yeni dosya):

```ts
async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const r = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  if (!r.ok) throw new Error((await r.text()) || r.statusText);
  return r.json();
}

export const authApi = {
  me: () => api<User>("/api/me"),
  logout: () => api("/api/auth/logout", { method: "POST" }),
  googleUrl: () => "/api/auth/google/start",
};

export const tasksApi = {
  list: (trash = false) => api<Task[]>(`/api/tasks${trash ? "?trash=1" : ""}`),
  create: (t: Partial<Task>) => api<Task>("/api/tasks", { method: "POST", body: JSON.stringify(t) }),
  update: (id: string, patch: Partial<Task>) =>
    api<Task>(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  remove: (id: string) => api(`/api/tasks/${id}`, { method: "DELETE" }),
  restore: (id: string) => api(`/api/tasks/${id}/restore`, { method: "POST" }),
};

export const commentsApi = {
  list: (taskId: string) => api<Comment[]>(`/api/tasks/${taskId}/comments`),
  create: (taskId: string, body: string, kind: string, parentId?: string) =>
    api<Comment>(`/api/tasks/${taskId}/comments`, {
      method: "POST",
      body: JSON.stringify({ body, kind, parent_id: parentId }),
    }),
};

export const githubApi = {
  status: () => api<{ connected: boolean; login: string | null }>("/api/github/status"),
  repos: () => api("/api/github/repos"),
  branches: (repo: string) => api(`/api/github/branches?repo=${encodeURIComponent(repo)}`),
  commits: (taskId: string) => api(`/api/tasks/${taskId}/commits`),
  syncCommits: (taskId: string) =>
    api(`/api/tasks/${taskId}/commits/sync`, { method: "POST" }),
};

export const adminApi = {
  users: () => api("/api/admin/users"),
  approve: (id: string) => api(`/api/admin/users/${id}/approve`, { method: "POST" }),
  revoke: (id: string) => api(`/api/admin/users/${id}/revoke`, { method: "POST" }),
};
```

### 2. Realtime — Supabase channel yerine WebSocket

`src/lib/realtime.ts`:

```ts
type Listener = (event: { table: string; op: string; id: string }) => void;
const listeners = new Set<Listener>();
let ws: WebSocket | null = null;

export function connectRealtime() {
  if (ws?.readyState === WebSocket.OPEN) return;
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${window.location.host}/ws`);
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.table) listeners.forEach((l) => l(msg));
    } catch {}
  };
  ws.onclose = () => setTimeout(connectRealtime, 2000);
}

export function onRealtime(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}
```

Board sayfasında:

```ts
useEffect(() => {
  connectRealtime();
  return onRealtime((ev) => {
    if (ev.table === "tasks") queryClient.invalidateQueries({ queryKey: ["tasks"] });
    if (ev.table === "task_comments") queryClient.invalidateQueries({ queryKey: ["comments"] });
    if (ev.table === "task_commits") queryClient.invalidateQueries({ queryKey: ["commits"] });
  });
}, []);
```

### 3. Auth akışı

- Login sayfası: sadece **"Google ile Giriş"** butonu →
  `window.location.href = "/api/auth/google/start"`.
- `_authenticated/route.tsx` içinde `supabase.auth.getUser()` yerine
  `authApi.me()` çağrılır; 401 dönerse `/auth`'a redirect.
- Approved check: `authApi.me()` sonucundaki `approved` alanına bakılır —
  false ise `PendingApprovalScreen` gösterilir (mevcut kod aynı çalışır).

### 4. Board.tsx içindeki supabase çağrıları

Örnek dönüşümler:

```ts
// ÖNCE
const { data } = await supabase.from("tasks").select("*").is("deleted_at", null);

// SONRA
const data = await tasksApi.list();
```

```ts
// ÖNCE
await supabase.from("tasks").update({ status: "done" }).eq("id", id);
// SONRA
await tasksApi.update(id, { status: "done" });
```

### 5. Build ve deploy

```bash
bun run build
rm -rf deploy/frontend
cp -r dist deploy/frontend
cd deploy && docker compose up -d --build
```

Frontend statik olarak backend tarafından servis edilir.
