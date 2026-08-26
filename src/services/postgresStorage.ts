import type { AuditRecord } from './auditService';
import { InsufficientBalanceError, StorageUnavailableError, type Storage, type TaskHistoryRecord } from './storage';
import type { TaskRecord } from '../types/task';
import type { WalletAccount, WalletLedgerEntry, WalletMutationInput, WalletMutationResult, WalletState, WalletTransaction } from '../types/wallet';
import type { ProjectIntent } from '../types/projectIntent';

interface QueryResult<T = unknown> { rows: T[]; rowCount: number | null; }
interface PoolClient { query<T = unknown>(text: string, values?: unknown[]): Promise<QueryResult<T>>; release(): void; }
interface PoolLike { connect(): Promise<PoolClient>; end(): Promise<void>; }

const migration = `
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
CREATE TABLE IF NOT EXISTS kc_ai_project_intents (
  project_id text PRIMARY KEY,
  owner_id text NOT NULL,
  intent jsonb NOT NULL,
  version bigint NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS kc_ai_project_intents_owner_idx ON kc_ai_project_intents(owner_id);
`;

export interface PostgresStorageOptions {
  connectionString?: string;
  pool?: PoolLike;
}

export class PostgresStorage implements Storage {
  private initialized = false;
  private readonly pool: PoolLike;

  constructor(options: PostgresStorageOptions = {}) {
    if (options.pool) {
      this.pool = options.pool;
      return;
    }
    if (!options.connectionString) throw new StorageUnavailableError('KC_AI_DATABASE_URL is required for PostgreSQL storage');
    const { Pool } = require('pg') as { Pool: new (options: { connectionString: string; max: number; ssl?: { rejectUnauthorized: boolean } }) => PoolLike };
    this.pool = new Pool({ connectionString: options.connectionString, max: 10, ssl: process.env.KC_AI_DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined });
  }

  async initialize(): Promise<void> {
    const client = await this.getClient();
    try {
      await client.query('BEGIN');
      for (const statement of migration.split(';').map((part) => part.trim()).filter(Boolean)) await client.query(statement);
      await client.query('COMMIT');
      this.initialized = true;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw new StorageUnavailableError('PostgreSQL storage initialization failed', { cause: error });
    } finally { client.release(); }
  }

  async close(): Promise<void> { await this.pool.end(); this.initialized = false; }

  private async getClient(): Promise<PoolClient> {
    try { return await this.pool.connect(); } catch (error) { throw new StorageUnavailableError('PostgreSQL storage connection failed', { cause: error }); }
  }

  private ensureInitialized(): void { if (!this.initialized) throw new StorageUnavailableError('PostgreSQL storage has not been initialized'); }

  async createTask(task: TaskRecord): Promise<TaskRecord> {
    this.ensureInitialized();
    const client = await this.getClient();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO kc_ai_tasks (task_id, task, created_at, updated_at) VALUES ($1, $2::jsonb, $3, $4)', [task.taskId, JSON.stringify(task), task.createdAt, task.updatedAt]);
      await client.query('INSERT INTO kc_ai_task_history (task_id, status, recorded_at, task) VALUES ($1, $2, $3, $4::jsonb)', [task.taskId, task.status, task.updatedAt, JSON.stringify(task)]);
      await client.query('COMMIT');
      return { ...task, progress: [...task.progress] };
    } catch (error) { try { await client.query('ROLLBACK'); } catch {} throw new StorageUnavailableError('Task creation transaction failed', { cause: error }); } finally { client.release(); }
  }

  async updateTask(task: TaskRecord): Promise<TaskRecord> {
    this.ensureInitialized();
    const client = await this.getClient();
    try {
      await client.query('BEGIN');
      const current = await client.query<{ task: TaskRecord; version: string }>('SELECT task, version FROM kc_ai_tasks WHERE task_id = $1 FOR UPDATE', [task.taskId]);
      if (!current.rows[0]) throw new StorageUnavailableError('Task does not exist');
      await client.query('UPDATE kc_ai_tasks SET task = $2::jsonb, version = version + 1, updated_at = $3 WHERE task_id = $1', [task.taskId, JSON.stringify(task), task.updatedAt]);
      await client.query('INSERT INTO kc_ai_task_history (task_id, status, recorded_at, task) VALUES ($1, $2, $3, $4::jsonb)', [task.taskId, task.status, task.updatedAt, JSON.stringify(task)]);
      await client.query('COMMIT');
      return { ...task, progress: [...task.progress] };
    } catch (error) { try { await client.query('ROLLBACK'); } catch {} throw new StorageUnavailableError('Task update transaction failed', { cause: error }); } finally { client.release(); }
  }

  async getTask(taskId: string): Promise<TaskRecord | undefined> { return (await this.queryTask(taskId)).task; }

  private async queryTask(taskId: string): Promise<{ task?: TaskRecord }> {
    this.ensureInitialized();
    const client = await this.getClient();
    try { const result = await client.query<{ task: TaskRecord }>('SELECT task FROM kc_ai_tasks WHERE task_id = $1', [taskId]); return { task: result.rows[0]?.task }; }
    finally { client.release(); }
  }

  async listTasks(): Promise<TaskRecord[]> {
    this.ensureInitialized(); const client = await this.getClient();
    try { const result = await client.query<{ task: TaskRecord }>('SELECT task FROM kc_ai_tasks ORDER BY created_at'); return result.rows.map((row) => ({ ...row.task, progress: [...row.task.progress] })); }
    finally { client.release(); }
  }

  async listTaskHistory(taskId: string): Promise<TaskHistoryRecord[]> {
    this.ensureInitialized(); const client = await this.getClient();
    try { const result = await client.query<TaskHistoryRecord>('SELECT task_id AS "taskId", status, recorded_at AS "recordedAt", task FROM kc_ai_task_history WHERE task_id = $1 ORDER BY history_id', [taskId]); return result.rows.map((row) => ({ ...row, task: { ...row.task, progress: [...row.task.progress] } })); }
    finally { client.release(); }
  }

  async appendAudit(record: AuditRecord): Promise<AuditRecord> {
    this.ensureInitialized(); const client = await this.getClient();
    try { await client.query('INSERT INTO kc_ai_audit_records (action_type, timestamp, task_id, actor_role, outcome, verification_status, error) VALUES ($1, $2, $3, $4, $5, $6, $7)', [record.actionType, record.timestamp, record.taskId, record.actorRole, record.outcome, record.verificationStatus, record.error]); return { ...record }; }
    finally { client.release(); }
  }

  async listAuditRecords(): Promise<AuditRecord[]> {
    this.ensureInitialized(); const client = await this.getClient();
    try { const result = await client.query<AuditRecord>('SELECT action_type AS "actionType", timestamp, task_id AS "taskId", actor_role AS "actorRole", outcome, verification_status AS "verificationStatus", error FROM kc_ai_audit_records ORDER BY audit_id'); return result.rows.map((row) => { const copy = { ...row }; if (copy.error === null) delete copy.error; return copy; }); }
    finally { client.release(); }
  }

  async clearAuditRecords(): Promise<void> { this.ensureInitialized(); const client = await this.getClient(); try { await client.query('DELETE FROM kc_ai_audit_records'); } finally { client.release(); } }

  async createProjectIntent(intent: ProjectIntent): Promise<ProjectIntent> {
    this.ensureInitialized(); const client = await this.getClient();
    try { await client.query('INSERT INTO kc_ai_project_intents (project_id, owner_id, intent, version, created_at, updated_at) VALUES ($1, $2, $3::jsonb, $4, $5, $6)', [intent.projectId, intent.ownerId, JSON.stringify(intent), intent.version, intent.createdAt, intent.updatedAt]); return { ...intent }; }
    finally { client.release(); }
  }

  async updateProjectIntent(intent: ProjectIntent): Promise<ProjectIntent> {
    this.ensureInitialized(); const client = await this.getClient();
    try { const result = await client.query('UPDATE kc_ai_project_intents SET intent = $3::jsonb, version = $4, updated_at = $5 WHERE project_id = $1 AND owner_id = $2', [intent.projectId, intent.ownerId, JSON.stringify(intent), intent.version, intent.updatedAt]); if (!result.rowCount) throw new StorageUnavailableError('Project intent does not exist'); return { ...intent }; }
    finally { client.release(); }
  }

  async getProjectIntent(projectId: string, ownerId: string): Promise<ProjectIntent | undefined> {
    this.ensureInitialized(); const client = await this.getClient();
    try { const result = await client.query<{ intent: ProjectIntent }>('SELECT intent FROM kc_ai_project_intents WHERE project_id = $1 AND owner_id = $2', [projectId, ownerId]); return result.rows[0]?.intent ? { ...result.rows[0].intent } : undefined; }
    finally { client.release(); }
  }

  async createWalletAccount(account: WalletAccount): Promise<WalletAccount> {
    this.ensureInitialized(); const client = await this.getClient();
    try { await client.query('INSERT INTO kc_ai_wallet_accounts (wallet_id, owner_id, status, created_at) VALUES ($1, $2, $3, $4)', [account.walletId, account.ownerId, account.status, account.createdAt]); return { ...account }; }
    catch (error) { throw new StorageUnavailableError('Wallet account creation failed', { cause: error }); }
    finally { client.release(); }
  }

  async getWalletState(walletId: string): Promise<WalletState | undefined> {
    this.ensureInitialized(); const client = await this.getClient();
    try {
      const account = await client.query<WalletAccount>('SELECT wallet_id AS "walletId", owner_id AS "ownerId", status, created_at AS "createdAt" FROM kc_ai_wallet_accounts WHERE wallet_id = $1', [walletId]);
      if (!account.rows[0]) return undefined;
      const transactions = await client.query<WalletTransaction>('SELECT transaction_id AS "transactionId", wallet_id AS "walletId", idempotency_key AS "idempotencyKey", currency, amount_minor::text AS "amountMinor", direction, reference, status, provider_confirmed AS "providerConfirmed", failure_reason AS "failureReason", reversal_of AS "reversalOf", created_at AS "createdAt", updated_at AS "updatedAt" FROM kc_ai_wallet_transactions WHERE wallet_id = $1 ORDER BY created_at', [walletId]);
      const ledger = await client.query<WalletLedgerEntry>('SELECT entry_id AS "entryId", wallet_id AS "walletId", transaction_id AS "transactionId", currency, direction, amount_minor::text AS "amountMinor", reference, created_at AS "createdAt", reversal_of AS "reversalOf" FROM kc_ai_wallet_ledger WHERE wallet_id = $1 ORDER BY created_at, entry_id', [walletId]);
      return { account: { ...account.rows[0] }, transactions: transactions.rows.map((row) => ({ ...row, providerConfirmed: false })), ledger: ledger.rows.map((row) => ({ ...row })) };
    } finally { client.release(); }
  }

  async getWalletAccount(ownerId: string): Promise<WalletAccount | undefined> {
    this.ensureInitialized(); const client = await this.getClient();
    try { const result = await client.query<WalletAccount>('SELECT wallet_id AS "walletId", owner_id AS "ownerId", status, created_at AS "createdAt" FROM kc_ai_wallet_accounts WHERE owner_id = $1', [ownerId]); return result.rows[0] ? { ...result.rows[0] } : undefined; }
    finally { client.release(); }
  }

  async applyWalletMutation(input: WalletMutationInput): Promise<WalletMutationResult> {
    this.ensureInitialized(); const client = await this.getClient();
    try {
      await client.query('BEGIN');
      const existing = await client.query<WalletTransaction>('SELECT transaction_id AS "transactionId", wallet_id AS "walletId", idempotency_key AS "idempotencyKey", currency, amount_minor::text AS "amountMinor", direction, reference, status, provider_confirmed AS "providerConfirmed", failure_reason AS "failureReason", reversal_of AS "reversalOf", created_at AS "createdAt", updated_at AS "updatedAt" FROM kc_ai_wallet_transactions WHERE wallet_id = $1 AND idempotency_key = $2 FOR UPDATE', [input.walletId, input.idempotencyKey]);
      if (existing.rows[0]) { await client.query('COMMIT'); return { transaction: { ...existing.rows[0], providerConfirmed: false }, duplicate: true }; }
      await client.query('SELECT wallet_id FROM kc_ai_wallet_accounts WHERE wallet_id = $1 FOR UPDATE', [input.walletId]);
      const balance = await client.query<{ balance: string | null }>("SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_minor ELSE -amount_minor END), 0)::text AS balance FROM kc_ai_wallet_ledger WHERE wallet_id = $1 AND currency = $2", [input.walletId, input.currency]);
      if (input.direction === 'DEBIT' && BigInt(balance.rows[0]?.balance || '0') < BigInt(input.amountMinor)) throw new InsufficientBalanceError('Insufficient wallet balance');
      const status = input.reversalOf ? 'REVERSED' : 'UNVERIFIED';
      await client.query('INSERT INTO kc_ai_wallet_transactions (transaction_id, wallet_id, idempotency_key, currency, amount_minor, direction, reference, status, provider_confirmed, reversal_of, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9, $10, $10)', [input.transactionId, input.walletId, input.idempotencyKey, input.currency, input.amountMinor, input.direction, input.reference, status, input.reversalOf, input.now]);
      await client.query('INSERT INTO kc_ai_wallet_ledger (entry_id, wallet_id, transaction_id, currency, direction, amount_minor, reference, reversal_of, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [`entry_${input.transactionId}`, input.walletId, input.transactionId, input.currency, input.direction, input.amountMinor, input.reference, input.reversalOf, input.now]);
      await client.query('COMMIT');
      return { transaction: { transactionId: input.transactionId, walletId: input.walletId, idempotencyKey: input.idempotencyKey, currency: input.currency, amountMinor: input.amountMinor, direction: input.direction, reference: input.reference, status, createdAt: input.now, updatedAt: input.now, providerConfirmed: false, reversalOf: input.reversalOf }, duplicate: false };
    } catch (error) { try { await client.query('ROLLBACK'); } catch {} if (error instanceof StorageUnavailableError || error instanceof InsufficientBalanceError) throw error; throw new StorageUnavailableError('Wallet mutation transaction failed', { cause: error }); }
    finally { client.release(); }
  }
}
