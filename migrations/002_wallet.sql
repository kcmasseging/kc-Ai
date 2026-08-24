CREATE TABLE IF NOT EXISTS kc_ai_wallet_accounts (
  wallet_id text PRIMARY KEY,
  owner_id text NOT NULL UNIQUE,
  status text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS kc_ai_wallet_transactions (
  transaction_id text PRIMARY KEY,
  wallet_id text NOT NULL REFERENCES kc_ai_wallet_accounts(wallet_id),
  idempotency_key text NOT NULL,
  currency text NOT NULL,
  amount_minor numeric(38, 0) NOT NULL CHECK (amount_minor > 0),
  direction text NOT NULL CHECK (direction IN ('CREDIT', 'DEBIT')),
  reference text NOT NULL,
  status text NOT NULL,
  provider_confirmed boolean NOT NULL DEFAULT false,
  failure_reason text,
  reversal_of text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (wallet_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS kc_ai_wallet_ledger (
  entry_id text PRIMARY KEY,
  wallet_id text NOT NULL REFERENCES kc_ai_wallet_accounts(wallet_id),
  transaction_id text NOT NULL REFERENCES kc_ai_wallet_transactions(transaction_id),
  currency text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('CREDIT', 'DEBIT')),
  amount_minor numeric(38, 0) NOT NULL CHECK (amount_minor > 0),
  reference text NOT NULL,
  reversal_of text,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS kc_ai_wallet_ledger_balance_idx ON kc_ai_wallet_ledger(wallet_id, currency);
