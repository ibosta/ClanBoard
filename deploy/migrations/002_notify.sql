-- Realtime notify triggers — emit the full row so the frontend shim can
-- deliver Supabase-style payloads without an extra round-trip.
CREATE OR REPLACE FUNCTION notify_change() RETURNS trigger AS $$
DECLARE
  row_data JSON;
  payload JSON;
BEGIN
  IF TG_OP = 'DELETE' THEN
    row_data := row_to_json(OLD);
  ELSE
    row_data := row_to_json(NEW);
  END IF;
  payload := json_build_object(
    'table', TG_TABLE_NAME,
    'op', TG_OP,
    'row', row_data
  );
  PERFORM pg_notify('hyperush_changes', payload::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_notify AFTER INSERT OR UPDATE OR DELETE ON tasks
  FOR EACH ROW EXECUTE FUNCTION notify_change();
CREATE TRIGGER comments_notify AFTER INSERT OR UPDATE OR DELETE ON task_comments
  FOR EACH ROW EXECUTE FUNCTION notify_change();
CREATE TRIGGER commits_notify AFTER INSERT OR UPDATE OR DELETE ON task_commits
  FOR EACH ROW EXECUTE FUNCTION notify_change();
CREATE TRIGGER users_notify AFTER INSERT OR UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION notify_change();
