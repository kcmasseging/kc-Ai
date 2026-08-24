export type TaskStatus =
  | 'received'
  | 'planning'
  | 'executing'
  | 'validating'
  | 'blocked'
  | 'completed'
  | 'failed';

export type CapabilityStatus =
  | 'available'
  | 'temporarily-unavailable'
  | 'authorization-required'
  | 'credentials-required'
  | 'payment-required'
  | 'external-integration-required'
  | 'planned';

export interface TaskRecord {
  taskId: string;
  goal: string;
  privateBuildId?: string;
  appContext?: {
    appId?: string;
    appName?: string;
  };
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  progress: string[];
  lastSuccessfulStep?: string;
  lastError?: string;
  requiredCapability?: string;
  blockedReason?: string;
  verificationStatus: 'not-verified' | 'verified';
}
