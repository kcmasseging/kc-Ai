export type BuilderDecisionClass = 'NORMAL_DEVELOPMENT' | 'SENSITIVE_OWNER_REQUIRED';

export interface BuilderDecisionPolicy {
  normal: BuilderDecisionClass;
  sensitive: BuilderDecisionClass;
  normalExamples: string[];
  sensitiveExamples: string[];
}

export type BuilderQuestionCategory = 'REQUIREMENT' | 'DESIGN' | 'INTEGRATION' | 'SECURITY' | 'BUSINESS_RULE' | 'OTHER';

export interface BuilderQuestion {
  builderQuestionId: string;
  projectId: string;
  specificationVersion: number;
  question: string;
  category: BuilderQuestionCategory;
  blocking: boolean;
  evidence?: string;
  suggestedOptions?: string[];
  createdAt: string;
}

export type BuilderProgressStatus = 'QUEUED' | 'UNDERSTANDING' | 'BUILDING' | 'TESTING' | 'FIXING' | 'WAIT';

export interface BuilderProgress {
  projectId: string;
  handoffId: string;
  buildRunId: string;
  status: BuilderProgressStatus;
  currentStep?: string;
  completedSteps: string[];
  tests: string[];
  buildResult?: string;
  blockers: string[];
  questions: BuilderQuestion[];
  artifacts: string[];
  updatedAt: string;
}

export type BuildRunStatus = BuilderProgressStatus | 'COMPLETED' | 'FAILED' | 'BLOCKED';

export interface Project {
  projectId: string;
  name: string;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
}

export interface BuildRun {
  buildRunId: string;
  projectId: string;
  handoffId: string;
  specificationVersion: number;
  status: BuildRunStatus;
  currentStep?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityLogItem {
  activityId: string;
  projectId: string;
  buildRunId?: string;
  action: string;
  outcome: 'started' | 'completed' | 'blocked' | 'failed';
  detail?: string;
  createdAt: string;
}