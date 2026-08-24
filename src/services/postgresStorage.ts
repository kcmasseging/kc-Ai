import type { AuditRecord } from './auditService';
import { StorageUnavailableError, type Storage, type TaskHistoryRecord } from './storage';
import type { TaskRecord } from '../types/task';

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
}
