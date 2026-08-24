import { loadJsonArray, writeJsonArray } from './localStore';
import type { AuditRecord } from './auditService';
import type { TaskRecord } from '../types/task';

export interface TaskHistoryRecord {
  taskId: string;
  status: TaskRecord['status'];
  recordedAt: string;
  task: TaskRecord;
}

export interface Storage {
  initialize(): Promise<void>;
  close(): Promise<void>;
  createTask(task: TaskRecord): Promise<TaskRecord>;
  updateTask(task: TaskRecord): Promise<TaskRecord>;
  getTask(taskId: string): Promise<TaskRecord | undefined>;
  listTasks(): Promise<TaskRecord[]>;
  listTaskHistory(taskId: string): Promise<TaskHistoryRecord[]>;
  appendAudit(record: AuditRecord): Promise<AuditRecord>;
  listAuditRecords(): Promise<AuditRecord[]>;
  clearAuditRecords(): Promise<void>;
}

export class StorageUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StorageUnavailableError';
  }
}

export class LocalStorage implements Storage {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly history: TaskHistoryRecord[];
  private readonly audits: AuditRecord[];
  private initialized = true;

  constructor(
    private readonly taskPath = process.env.KC_AI_TASK_STORE_PATH || '.kc-ai-tasks.json',
    private readonly auditPath = process.env.KC_AI_AUDIT_STORE_PATH || '.kc-ai-audit.json',
    private readonly historyPath = process.env.KC_AI_TASK_HISTORY_STORE_PATH || '.kc-ai-task-history.json',
  ) {
    this.history = loadJsonArray<TaskHistoryRecord>(historyPath);
    this.audits = loadJsonArray<AuditRecord>(auditPath);
    for (const task of loadJsonArray<TaskRecord>(taskPath)) this.tasks.set(task.taskId, task);
  }

  async initialize(): Promise<void> { this.initialized = true; }
  async close(): Promise<void> { this.initialized = false; }

  private ensureInitialized(): void {
    if (!this.initialized) throw new StorageUnavailableError('Storage has not been initialized');
  }

  async createTask(task: TaskRecord): Promise<TaskRecord> {
    this.ensureInitialized();
    this.tasks.set(task.taskId, task);
    this.history.push({ taskId: task.taskId, status: task.status, recordedAt: task.updatedAt, task: { ...task, progress: [...task.progress] } });
    this.persist();
    return this.copyTask(task);
  }

  async updateTask(task: TaskRecord): Promise<TaskRecord> {
    this.ensureInitialized();
    this.tasks.set(task.taskId, task);
    const previous = this.history[this.history.length - 1];
    if (!previous || previous.taskId !== task.taskId || previous.status !== task.status) {
      this.history.push({ taskId: task.taskId, status: task.status, recordedAt: task.updatedAt, task: { ...task, progress: [...task.progress] } });
    }
    this.persist();
    return this.copyTask(task);
  }

  async getTask(taskId: string): Promise<TaskRecord | undefined> {
    this.ensureInitialized();
    const task = this.tasks.get(taskId);
    return task ? this.copyTask(task) : undefined;
  }

  async listTasks(): Promise<TaskRecord[]> {
    this.ensureInitialized();
    return [...this.tasks.values()].map((task) => this.copyTask(task));
  }

  async listTaskHistory(taskId: string): Promise<TaskHistoryRecord[]> {
    this.ensureInitialized();
    return this.history.filter((entry) => entry.taskId === taskId).map((entry) => ({ ...entry, task: this.copyTask(entry.task) }));
  }

  async appendAudit(record: AuditRecord): Promise<AuditRecord> {
    this.ensureInitialized();
    this.audits.push(record);
    writeJsonArray(this.auditPath, this.audits);
    return { ...record };
  }

  async listAuditRecords(): Promise<AuditRecord[]> {
    this.ensureInitialized();
    return this.audits.map((record) => ({ ...record }));
  }

  async clearAuditRecords(): Promise<void> {
    this.ensureInitialized();
    this.audits.length = 0;
    writeJsonArray(this.auditPath, this.audits);
  }

  private persist(): void {
    writeJsonArray(this.taskPath, [...this.tasks.values()]);
    writeJsonArray(this.historyPath, this.history);
  }

  private copyTask(task: TaskRecord): TaskRecord {
    return { ...task, progress: [...task.progress], appContext: task.appContext ? { ...task.appContext } : undefined };
  }
}

let activeStorage: Storage = new LocalStorage();

export function configureStorage(storage: Storage): void { activeStorage = storage; }
export function getStorage(): Storage { return activeStorage; }
export async function initializeStorage(): Promise<void> { await activeStorage.initialize(); }
export async function closeStorage(): Promise<void> { await activeStorage.close(); }
