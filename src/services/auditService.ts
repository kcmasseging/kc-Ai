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

function safeError(error?: string): string | undefined {
  if (!error) return undefined;
  return error.replace(/(password|token|secret|api[-_ ]?key|credential)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]');
}

export function recordAudit(input: Omit<AuditRecord, 'timestamp' | 'error'> & { error?: string }): AuditRecord {
  const record: AuditRecord = { ...input, timestamp: new Date().toISOString(), error: safeError(input.error) };
  records.push(record);
  return { ...record };
}

export function listAuditRecords(): AuditRecord[] {
  return records.map((record) => ({ ...record }));
}

export function clearAuditRecords(): void {
  records.length = 0;
}
