export type HealthStatus = 'HEALTHY' | 'DEGRADED' | 'WARNING' | 'CRITICAL' | 'UNAVAILABLE' | 'UNVERIFIED';
export type HealthSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type RepairCategory = 'SAFE_AUTO_REPAIR' | 'OWNER_APPROVAL_REQUIRED';
export type RemediationStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'NOT_ATTEMPTED';

export interface HealthCheckResult {
  area: string;
  status: HealthStatus;
  evidence?: string;
  latencyMs?: number;
}

export interface HealthIssue {
  issueId: string;
  product: string;
  component: string;
  timestamp: string;
  severity: HealthSeverity;
  symptom: string;
  evidence: string;
  probableCause: string;
  verificationStatus: 'VERIFIED' | 'UNVERIFIED';
  recommendedAction: string;
  remediationStatus: RemediationStatus;
  resolutionEvidence?: string;
  alertSuppressed: boolean;
}

export interface ProductHealthSnapshot {
  product: string;
  checkedAt: string;
  status: HealthStatus;
  checks: HealthCheckResult[];
  issues: HealthIssue[];
}
