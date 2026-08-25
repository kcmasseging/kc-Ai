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
  capabilityUsed?: string;
  verificationResult?: string;
  query?: string;
  providerName?: string;
  resultCount?: number;
  lifecycleTransitions?: Array<{ state: string; timestamp: string; evidence?: string }>;
  goalHash?: string;
  classification?: string;
  classificationTimestamp?: string;
  priorContextUsed?: boolean;
  explicitTaskReference?: string;
}

export function redactSensitive(error?: string): string | undefined {
  if (!error) return undefined;
  return error.replace(/(password|token|secret|api[-_ ]?key|credential)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]');
}

export async function recordAudit(input: Omit<AuditRecord, 'timestamp' | 'error'> & { error?: string }): Promise<AuditRecord> {
  const record: AuditRecord = { ...input, query: redactSensitive(input.query), timestamp: new Date().toISOString(), error: redactSensitive(input.error), verificationResult: redactSensitive(input.verificationResult) };
  return getStorage().appendAudit(record);
}

export function listAuditRecords(): Promise<AuditRecord[]> {
  return getStorage().listAuditRecords();
}

export function clearAuditRecords(): Promise<void> {
  return getStorage().clearAuditRecords();
}

export function reloadAuditRecords(): Promise<void> { return Promise.resolve(); }
