CREATE TABLE IF NOT EXISTS kc_ai_tasks (
  task_id text PRIMARY KEY,
  task jsonb NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS kc_ai_task_history (
  history_id bigserial PRIMARY KEY,
  task_id text NOT NULL REFERENCES kc_ai_tasks(task_id) ON DELETE CASCADE,
  status text NOT NULL,
  recorded_at timestamptz NOT NULL,
  task jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS kc_ai_task_history_task_id_idx ON kc_ai_task_history(task_id, history_id);

CREATE TABLE IF NOT EXISTS kc_ai_audit_records (
  audit_id bigserial PRIMARY KEY,
  action_type text NOT NULL,
  timestamp timestamptz NOT NULL,
  task_id text,
  actor_role text NOT NULL,
  outcome text NOT NULL,
  verification_status text NOT NULL,
  error text
);

CREATE INDEX IF NOT EXISTS kc_ai_audit_timestamp_idx ON kc_ai_audit_records(timestamp);
