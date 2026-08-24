import { loadJsonArray, writeJsonArray } from './localStore';

export type AuditOutcome = 'started' | 'completed' | 'blocked' | 'failed';

export interface AuditRecord {
  actionType: string;
  timestamp: string;
  taskId?: string;
  actorRole: 'system' | 'user' | 'owner';
  outcome: AuditOutcome;
  verificationStatus: 'not-verified' | 'verified';
  error?: string;
}

const records: AuditRecord[] = [];
const auditStorePath = process.env.KC_AI_AUDIT_STORE_PATH || '.kc-ai-audit.json';

function persistRecords(): void {
  writeJsonArray(auditStorePath, records);
}

function loadRecords(): void {
  records.push(...loadJsonArray<AuditRecord>(auditStorePath));
}

loadRecords();

function safeError(error?: string): string | undefined {
  if (!error) return undefined;
  return error.replace(/(password|token|secret|api[-_ ]?key|credential)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]');
}

export function recordAudit(input: Omit<AuditRecord, 'timestamp' | 'error'> & { error?: string }): AuditRecord {
  const record: AuditRecord = { ...input, timestamp: new Date().toISOString(), error: safeError(input.error) };
  records.push(record);
  persistRecords();
  return { ...record };
}

export function listAuditRecords(): AuditRecord[] {
  return records.map((record) => ({ ...record }));
}

export function clearAuditRecords(): void {
  records.length = 0;
  persistRecords();
}

export function reloadAuditRecords(): void {
  records.length = 0;
  loadRecords();
}
