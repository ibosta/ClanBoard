-- Enums
CREATE TYPE app_role AS ENUM ('admin', 'member');
CREATE TYPE task_status AS ENUM ('todo', 'in_progress', 'review', 'done');
CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high', 'urgent');
CREATE TYPE task_category AS ENUM ('feature', 'bug', 'improvement', 'chore', 'design', 'docs');
CREATE TYPE comment_type AS ENUM ('note', 'question', 'update', 'blocker');

-- Users (Google OAuth). Frontend refers to this as "profiles" via the API shim.
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  role app_role NOT NULL DEFAULT 'member',
  approved BOOLEAN NOT NULL DEFAULT FALSE,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tasks
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  status task_status NOT NULL DEFAULT 'todo',
  priority task_priority NOT NULL DEFAULT 'medium',
  category task_category NOT NULL DEFAULT 'feature',
  assignee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  due_date DATE,
  tags TEXT[] NOT NULL DEFAULT '{}',
  repo_full_name TEXT,
  branch TEXT,
  issue_number INTEGER,
  position INTEGER NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_status ON tasks(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_tasks_deleted ON tasks(deleted_at);

-- Comments (with threading). Frontend uses `content` / `type`.
CREATE TABLE task_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  parent_id UUID REFERENCES task_comments(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  type comment_type NOT NULL DEFAULT 'note',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_comments_task ON task_comments(task_id);
CREATE INDEX idx_comments_parent ON task_comments(parent_id);

-- GitHub connections (per user)
CREATE TABLE github_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  github_login TEXT NOT NULL,
  github_id BIGINT NOT NULL,
  github_avatar_url TEXT,
  access_token_ciphertext TEXT NOT NULL,
  scope TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Commits linked to tasks
CREATE TABLE task_commits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  repo_full_name TEXT NOT NULL,
  sha TEXT NOT NULL,
  short_sha TEXT NOT NULL,
  message TEXT NOT NULL,
  author_name TEXT,
  author_login TEXT,
  author_avatar_url TEXT,
  html_url TEXT NOT NULL,
  committed_at TIMESTAMPTZ NOT NULL,
  branch TEXT,
  added_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(task_id, sha)
);

CREATE INDEX idx_commits_task ON task_commits(task_id, committed_at DESC);
