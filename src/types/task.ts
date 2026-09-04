export type TaskStatus =
  | 'received'
  | 'created'
  | 'classified'
  | 'planning'
  | 'planned'
  | 'executing'
  | 'verifying'
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
  ownerId?: string;
  goal: string;
  projectId?: string;
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
  executionContext?: {
    contextId: string;
    rawGoalHash: string;
    classificationTimestamp: string;
    priorContextUsed: boolean;
    explicitTaskReference?: string;
  };
  understanding?: {
    requestedAction: string;
    target?: string;
    parameters: Record<string, string>;
    externalSideEffect: boolean;
  };
  executionPlan?: {
    taskId: string;
    requiredCapability: string;
    intendedAction: string;
    expectedResult: string;
    validationRequirement: string;
    ownerProfileApplied?: {
      preferredWorkingMethod?: string;
      outputStyle?: string;
      autonomy?: string;
      workingContext: string[];
    };
  };
  executionEvidence?: string;
  result?: string;
  verificationResult?: string;
  finalResult?: string;
  webSearch?: {
    query: string;
    provider: string;
    results: Array<{ title: string; domain: string; url: string; snippet: string; rank: number; publicationDate?: string }>;
    summary: string;
  };
  sources?: Array<{
    title: string;
    url: string;
    domain: string;
    snippet?: string;
    publicationDate?: string;
    provider: string;
    retrievedAt: string;
  }>;
}
