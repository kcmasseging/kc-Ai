import { getStorage } from './storage';

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

function safeError(error?: string): string | undefined {
  if (!error) return undefined;
  return error.replace(/(password|token|secret|api[-_ ]?key|credential)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]');
}

export async function recordAudit(input: Omit<AuditRecord, 'timestamp' | 'error'> & { error?: string }): Promise<AuditRecord> {
  const record: AuditRecord = { ...input, timestamp: new Date().toISOString(), error: safeError(input.error) };
  return getStorage().appendAudit(record);
}

export function listAuditRecords(): Promise<AuditRecord[]> {
  return getStorage().listAuditRecords();
}

export function clearAuditRecords(): Promise<void> {
  return getStorage().clearAuditRecords();
}

export function reloadAuditRecords(): Promise<void> { return Promise.resolve(); }
