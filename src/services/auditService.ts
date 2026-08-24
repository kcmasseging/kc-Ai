import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

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
  const temporaryPath = `${auditStorePath}.${process.pid}.tmp`;
  const directory = auditStorePath.includes('/') ? auditStorePath.slice(0, auditStorePath.lastIndexOf('/')) : '.';
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(temporaryPath, JSON.stringify(records), { mode: 0o600 });
  renameSync(temporaryPath, auditStorePath);
}

function loadRecords(): void {
  if (!existsSync(auditStorePath)) return;
  try {
    const storedRecords = JSON.parse(readFileSync(auditStorePath, 'utf8')) as AuditRecord[];
    records.push(...storedRecords);
  } catch {}
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
