CREATE TABLE IF NOT EXISTS kc_ai_owner_profiles (
  owner_id text PRIMARY KEY,
  profile jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);