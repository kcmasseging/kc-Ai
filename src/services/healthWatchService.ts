import { randomUUID } from 'node:crypto';
import { recordAudit } from './auditService';
import type { HealthCheckResult, HealthIssue, HealthSeverity, HealthStatus, ProductHealthSnapshot, RepairCategory } from '../types/healthWatch';

export const monitoredProducts = ['KC AI', 'KC Telecom', 'KC Earn', 'KC Messaging', 'KC Business Suite', 'KC Browser'] as const;

export interface ProductHealthAdapter {
  product: string;
  check(): Promise<{ checks: HealthCheckResult[]; issues?: Omit<HealthIssue, 'issueId' | 'timestamp' | 'remediationStatus' | 'alertSuppressed'>[] }>;
}

export interface HealthRepair {
  category: RepairCategory;
  repair(issue: HealthIssue): Promise<{ attempted: boolean; evidence: string }>;
}

function redact(value: string): string {
  return value.replace(/(password|token|secret|api[-_ ]?key|credential|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]');
}

function issueFingerprint(issue: Omit<HealthIssue, 'issueId' | 'timestamp' | 'remediationStatus' | 'alertSuppressed'>): string {
  return `${issue.product}|${issue.component}|${issue.symptom}|${issue.severity}`;
}

function aggregateStatus(checks: HealthCheckResult[], issues: HealthIssue[]): HealthStatus {
  if (!checks.length) return 'UNVERIFIED';
  if (issues.some((issue) => issue.severity === 'CRITICAL')) return 'CRITICAL';
  if (issues.some((issue) => issue.severity === 'HIGH')) return 'DEGRADED';
  if (issues.length) return 'WARNING';
  return checks.every((check) => check.status === 'HEALTHY') ? 'HEALTHY' : checks.some((check) => check.status === 'UNAVAILABLE') ? 'UNAVAILABLE' : 'DEGRADED';
}

export class HealthWatchService {
  private readonly adapters = new Map<string, ProductHealthAdapter>();
  private readonly issues: HealthIssue[] = [];

  register(adapter: ProductHealthAdapter): void { this.adapters.set(adapter.product, adapter); }

  listProducts(): string[] { return [...monitoredProducts]; }

  async scan(): Promise<ProductHealthSnapshot[]> {
    const snapshots: ProductHealthSnapshot[] = [];
    for (const product of monitoredProducts) {
      const checkedAt = new Date().toISOString();
      const adapter = this.adapters.get(product);
      if (!adapter) {
        snapshots.push({ product, checkedAt, status: 'UNVERIFIED', checks: [], issues: [] });
        continue;
      }
      const result = await adapter.check();
      const issues = (result.issues || []).map((issue) => {
        const fingerprint = issueFingerprint(issue);
        const duplicate = this.issues.some((existing) => issueFingerprint(existing) === fingerprint && existing.remediationStatus !== 'RESOLVED');
        const created: HealthIssue = { ...issue, evidence: redact(issue.evidence), issueId: `issue_${randomUUID()}`, timestamp: checkedAt, remediationStatus: 'OPEN', alertSuppressed: duplicate };
        this.issues.push(created);
        return created;
      });
      snapshots.push({ product, checkedAt, status: aggregateStatus(result.checks, issues), checks: result.checks.map((check) => ({ ...check, evidence: check.evidence ? redact(check.evidence) : undefined })), issues });
    }
    return snapshots;
  }

  listIssues(): HealthIssue[] { return this.issues.map((issue) => ({ ...issue })); }

  async repair(issueId: string, repair: HealthRepair): Promise<HealthIssue> {
    const issue = this.issues.find((entry) => entry.issueId === issueId);
    if (!issue) throw new Error('Health issue not found');
    if (repair.category === 'OWNER_APPROVAL_REQUIRED') throw new Error('Owner approval is required for this repair category');
    issue.remediationStatus = 'IN_PROGRESS';
    await recordAudit({ actionType: 'health-watch.repair', actorRole: 'owner', outcome: 'started', verificationStatus: 'not-verified', error: issue.evidence });
    let result: { attempted: boolean; evidence: string };
    try { result = await repair.repair(issue); }
    catch (error) {
      issue.remediationStatus = 'OPEN';
      await recordAudit({ actionType: 'health-watch.repair-failed', actorRole: 'owner', outcome: 'failed', verificationStatus: 'not-verified', error: error instanceof Error ? error.message : 'Repair failed' });
      throw error;
    }
    if (!result.attempted) {
      issue.remediationStatus = 'OPEN';
      return { ...issue };
    }
    issue.remediationStatus = 'RESOLVED';
    issue.resolutionEvidence = redact(result.evidence);
    await recordAudit({ actionType: 'health-watch.repair-verified', actorRole: 'owner', outcome: 'completed', verificationStatus: 'verified', error: result.evidence });
    return { ...issue };
  }
}

export function createIssue(input: { product: string; component: string; severity: HealthSeverity; symptom: string; evidence: string; probableCause: string; recommendedAction: string }): Omit<HealthIssue, 'issueId' | 'timestamp' | 'remediationStatus' | 'alertSuppressed'> {
  return { ...input, verificationStatus: 'VERIFIED' };
}
