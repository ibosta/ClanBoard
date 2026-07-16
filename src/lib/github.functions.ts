// Standalone Docker build: these are plain client-side fetchers that talk to
// the local Express backend. They preserve the `{ data: {...} }` call shape
// (from the earlier TanStack `createServerFn` version) so existing call sites
// don't need to change.

async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const r = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(text || r.statusText);
  }
  if (r.status === 204) return null as unknown as T;
  return r.json() as Promise<T>;
}

type Empty = Record<string, never>;
type Wrapped<T> = { data: T } | Empty | undefined;

function unwrap<T>(arg: Wrapped<T>): Partial<T> {
  return (arg && "data" in arg ? arg.data : ({} as Partial<T>)) ?? ({} as Partial<T>);
}

export async function startGithubConnect(_arg?: Wrapped<{ origin: string }>) {
  // The Express backend owns the OAuth handshake; the client just navigates.
  return { authorizeUrl: "/api/auth/github/start" };
}

export async function getGithubStatus(_arg?: Empty) {
  return api<{
    connected: boolean;
    github_login?: string | null;
    github_avatar_url?: string | null;
    scope?: string | null;
    updated_at?: string | null;
  }>("/api/github/status");
}

export async function disconnectGithub(_arg?: Empty) {
  return api<{ ok: true }>("/api/github/disconnect", { method: "POST" });
}

export async function listMyRepos(_arg?: Empty) {
  return api<Array<{ full_name: string; private: boolean; description: string | null; pushed_at: string }>>(
    "/api/github/repos",
  );
}

export async function listRepoBranches(arg: Wrapped<{ repo_full_name: string }>) {
  const { repo_full_name } = unwrap(arg) as { repo_full_name: string };
  return api<string[]>(`/api/github/branches?repo=${encodeURIComponent(repo_full_name)}`);
}

export async function listRepoCommits(arg: Wrapped<{ repo_full_name: string; query?: string }>) {
  const { repo_full_name, query } = unwrap(arg) as { repo_full_name: string; query?: string };
  const rows = await api<Array<{
    sha: string;
    short_sha: string;
    message: string;
    html_url: string;
    author_name: string | null;
    author_login: string | null;
    author_avatar_url: string | null;
    committed_at: string | null;
  }>>(`/api/github/commits?repo=${encodeURIComponent(repo_full_name)}`);
  const q = query?.toLowerCase().trim();
  return q
    ? rows.filter((c) => c.message.toLowerCase().includes(q) || c.short_sha.includes(q))
    : rows;
}

export async function attachCommit(arg: Wrapped<{ task_id: string; repo_full_name: string; sha: string }>) {
  const { task_id, repo_full_name, sha } = unwrap(arg) as {
    task_id: string; repo_full_name: string; sha: string;
  };
  return api<{ ok: true }>(`/api/tasks/${task_id}/commits/attach`, {
    method: "POST",
    body: JSON.stringify({ repo_full_name, sha }),
  });
}

export async function syncRepoCommits(arg: Wrapped<{ task_id: string; repo_full_name: string; branch?: string | null }>) {
  const { task_id, repo_full_name, branch } = unwrap(arg) as {
    task_id: string; repo_full_name: string; branch?: string | null;
  };
  return api<{ inserted: number; total: number }>(`/api/tasks/${task_id}/commits/sync`, {
    method: "POST",
    body: JSON.stringify({ repo_full_name, branch: branch ?? null }),
  });
}
