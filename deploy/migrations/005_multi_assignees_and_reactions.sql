-- 1. Multi-assignee support
ALTER TABLE tasks ADD COLUMN assignee_ids UUID[] NOT NULL DEFAULT '{}'::UUID[];

-- Migrate existing data from assignee_id to assignee_ids
UPDATE tasks SET assignee_ids = ARRAY[assignee_id] WHERE assignee_id IS NOT NULL;

-- Remove old single-assignee column
ALTER TABLE tasks DROP COLUMN assignee_id;

-- 2. Emoji Reactions on task comments
CREATE TABLE comment_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id UUID NOT NULL REFERENCES task_comments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (comment_id, user_id, emoji)
);

-- Trigger to notify real-time updates for reactions
CREATE TRIGGER reactions_notify AFTER INSERT OR DELETE ON comment_reactions
  FOR EACH ROW EXECUTE FUNCTION notify_change();
