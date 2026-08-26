CREATE TABLE IF NOT EXISTS kc_ai_conversations (
  conversation_id text PRIMARY KEY,
  owner_id text NOT NULL,
  session_id text NOT NULL,
  conversation jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (owner_id, session_id)
);