import { loadJsonArray, writeJsonArray } from './localStore';
import type { AuditRecord } from './auditService';
import type { TaskRecord } from '../types/task';
import type { WalletAccount, WalletLedgerEntry, WalletMutationInput, WalletMutationResult, WalletState, WalletTransaction } from '../types/wallet';
import type { ProjectIntent } from '../types/projectIntent';
import type { ConversationRecord } from '../types/conversation';

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
  createWalletAccount(account: WalletAccount): Promise<WalletAccount>;
  getWalletAccount(ownerId: string): Promise<WalletAccount | undefined>;
  getWalletState(walletId: string): Promise<WalletState | undefined>;
  applyWalletMutation(input: WalletMutationInput): Promise<WalletMutationResult>;
  createProjectIntent(intent: ProjectIntent): Promise<ProjectIntent>;
  updateProjectIntent(intent: ProjectIntent): Promise<ProjectIntent>;
  getProjectIntent(projectId: string, ownerId: string): Promise<ProjectIntent | undefined>;
  listProjectIntents(ownerId: string): Promise<ProjectIntent[]>;
  getConversation(ownerId: string, sessionId: string): Promise<ConversationRecord | undefined>;
  saveConversation(conversation: ConversationRecord): Promise<ConversationRecord>;
}

export class StorageUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StorageUnavailableError';
  }
}

export class InsufficientBalanceError extends Error {}

export class LocalStorage implements Storage {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly history: TaskHistoryRecord[];
  private readonly audits: AuditRecord[];
  private readonly wallets: WalletState[];
  private readonly projectIntents: ProjectIntent[];
  private readonly conversations: ConversationRecord[];
  private initialized = true;

  constructor(
    private readonly taskPath = process.env.KC_AI_TASK_STORE_PATH || '.kc-ai-tasks.json',
    private readonly auditPath = process.env.KC_AI_AUDIT_STORE_PATH || '.kc-ai-audit.json',
    private readonly historyPath = process.env.KC_AI_TASK_HISTORY_STORE_PATH || '.kc-ai-task-history.json',
    private readonly walletPath = process.env.KC_AI_WALLET_STORE_PATH || '.kc-ai-wallets.json',
    private readonly projectIntentPath = process.env.KC_AI_PROJECT_INTENT_STORE_PATH || '.kc-ai-project-intents.json',
    private readonly conversationPath = process.env.KC_AI_CONVERSATION_STORE_PATH || '.kc-ai-conversations.json',
  ) {
    this.history = loadJsonArray<TaskHistoryRecord>(historyPath);
    this.audits = loadJsonArray<AuditRecord>(auditPath);
    this.wallets = loadJsonArray<WalletState>(walletPath);
    this.projectIntents = loadJsonArray<ProjectIntent>(projectIntentPath);
    this.conversations = loadJsonArray<ConversationRecord>(conversationPath);
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

  async createWalletAccount(account: WalletAccount): Promise<WalletAccount> {
    this.ensureInitialized();
    if (this.wallets.some((wallet) => wallet.account.walletId === account.walletId || wallet.account.ownerId === account.ownerId)) throw new StorageUnavailableError('Wallet account already exists');
    this.wallets.push({ account, transactions: [], ledger: [] });
    writeJsonArray(this.walletPath, this.wallets);
    return { ...account };
  }

  async getWalletState(walletId: string): Promise<WalletState | undefined> {
    this.ensureInitialized();
    const wallet = this.wallets.find((entry) => entry.account.walletId === walletId);
    return wallet ? this.copyWallet(wallet) : undefined;
  }

  async getWalletAccount(ownerId: string): Promise<WalletAccount | undefined> {
    this.ensureInitialized();
    const wallet = this.wallets.find((entry) => entry.account.ownerId === ownerId);
    return wallet ? { ...wallet.account } : undefined;
  }

  async applyWalletMutation(input: WalletMutationInput): Promise<WalletMutationResult> {
    this.ensureInitialized();
    const wallet = this.wallets.find((entry) => entry.account.walletId === input.walletId);
    if (!wallet) throw new StorageUnavailableError('Wallet account does not exist');
    const existing = wallet.transactions.find((transaction) => transaction.idempotencyKey === input.idempotencyKey);
    if (existing) return { transaction: { ...existing }, duplicate: true };
    const amount = BigInt(input.amountMinor);
    const balance = wallet.ledger.filter((entry) => entry.currency === input.currency).reduce((total, entry) => total + (entry.direction === 'CREDIT' ? BigInt(entry.amountMinor) : -BigInt(entry.amountMinor)), 0n);
    if (input.direction === 'DEBIT' && balance < amount) throw new InsufficientBalanceError('Insufficient wallet balance');
    const transaction: WalletTransaction = { transactionId: input.transactionId, walletId: input.walletId, idempotencyKey: input.idempotencyKey, currency: input.currency, amountMinor: input.amountMinor, direction: input.direction, reference: input.reference, status: input.reversalOf ? 'REVERSED' : 'UNVERIFIED', createdAt: input.now, updatedAt: input.now, providerConfirmed: false, reversalOf: input.reversalOf };
    const ledgerEntry: WalletLedgerEntry = { entryId: `entry_${input.transactionId}`, walletId: input.walletId, transactionId: input.transactionId, currency: input.currency, direction: input.direction, amountMinor: input.amountMinor, reference: input.reference, createdAt: input.now, reversalOf: input.reversalOf };
    wallet.transactions.push(transaction);
    wallet.ledger.push(ledgerEntry);
    writeJsonArray(this.walletPath, this.wallets);
    return { transaction: { ...transaction }, duplicate: false };
  }

  async createProjectIntent(intent: ProjectIntent): Promise<ProjectIntent> {
    this.ensureInitialized();
    this.projectIntents.push(this.copyProjectIntent(intent));
    this.persist();
    return this.copyProjectIntent(intent);
  }

  async updateProjectIntent(intent: ProjectIntent): Promise<ProjectIntent> {
    this.ensureInitialized();
    const index = this.projectIntents.findIndex((entry) => entry.projectId === intent.projectId && entry.ownerId === intent.ownerId);
    if (index < 0) throw new StorageUnavailableError('Project intent does not exist');
    this.projectIntents[index] = this.copyProjectIntent(intent);
    this.persist();
    return this.copyProjectIntent(intent);
  }

  async getProjectIntent(projectId: string, ownerId: string): Promise<ProjectIntent | undefined> {
    this.ensureInitialized();
    const intent = this.projectIntents.find((entry) => entry.projectId === projectId && entry.ownerId === ownerId);
    return intent ? this.copyProjectIntent(intent) : undefined;
  }

  async listProjectIntents(ownerId: string): Promise<ProjectIntent[]> { this.ensureInitialized(); return this.projectIntents.filter((entry) => entry.ownerId === ownerId).map((entry) => this.copyProjectIntent(entry)); }
  async getConversation(ownerId: string, sessionId: string): Promise<ConversationRecord | undefined> { this.ensureInitialized(); const value = this.conversations.find((entry) => entry.ownerId === ownerId && entry.sessionId === sessionId); return value ? this.copyConversation(value) : undefined; }
  async saveConversation(conversation: ConversationRecord): Promise<ConversationRecord> {
    this.ensureInitialized();
    const index = this.conversations.findIndex((entry) => entry.ownerId === conversation.ownerId && entry.sessionId === conversation.sessionId);
    if (index < 0) this.conversations.push(this.copyConversation(conversation)); else this.conversations[index] = this.copyConversation(conversation);
    this.persist();
    return this.copyConversation(conversation);
  }

  private persist(): void {
    writeJsonArray(this.taskPath, [...this.tasks.values()]);
    writeJsonArray(this.historyPath, this.history);
    writeJsonArray(this.projectIntentPath, this.projectIntents);
    writeJsonArray(this.conversationPath, this.conversations);
  }

  private copyProjectIntent(intent: ProjectIntent): ProjectIntent {
    return { ...intent, targetUsers: [...(intent.targetUsers || [])], confirmedRequirements: [...(intent.confirmedRequirements || [])], functionalRequirements: [...(intent.functionalRequirements || [])], nonFunctionalRequirements: [...(intent.nonFunctionalRequirements || [])], designRequirements: [...(intent.designRequirements || [])], integrations: [...(intent.integrations || [])], securityRequirements: [...(intent.securityRequirements || [])], businessRules: [...(intent.businessRules || [])], inferredRequirements: [...(intent.inferredRequirements || [])], rejectedRequirements: [...(intent.rejectedRequirements || [])], unresolvedQuestions: [...(intent.unresolvedQuestions || [])], constraints: [...(intent.constraints || [])], decisions: [...(intent.decisions || [])], corrections: [...(intent.corrections || [])], dependencies: [...(intent.dependencies || [])], acceptanceCriteria: [...(intent.acceptanceCriteria || [])] };
  }

  private copyTask(task: TaskRecord): TaskRecord {
    return { ...task, progress: [...task.progress], appContext: task.appContext ? { ...task.appContext } : undefined, webSearch: task.webSearch ? { ...task.webSearch, results: task.webSearch.results.map((result) => ({ ...result })) } : undefined };
  }

  private copyConversation(conversation: ConversationRecord): ConversationRecord { return { ...conversation, messages: conversation.messages.map((message) => ({ ...message })) }; }

  private copyWallet(wallet: WalletState): WalletState {
    return { account: { ...wallet.account }, transactions: wallet.transactions.map((transaction) => ({ ...transaction })), ledger: wallet.ledger.map((entry) => ({ ...entry })) };
  }
}

let activeStorage: Storage = new LocalStorage();

export function configureStorage(storage: Storage): void { activeStorage = storage; }
export function getStorage(): Storage { return activeStorage; }
export async function initializeStorage(): Promise<void> { await activeStorage.initialize(); }
export async function closeStorage(): Promise<void> { await activeStorage.close(); }
