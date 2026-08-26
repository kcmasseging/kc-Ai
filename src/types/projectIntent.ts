export type ProjectReadiness = 'DISCOVERY' | 'NEEDS_CLARIFICATION' | 'SPECIFICATION_IN_PROGRESS' | 'READY_FOR_OWNER_REVIEW' | 'APPROVED_FOR_BUILD';

export interface ProjectIntent {
  projectId: string;
  ownerId: string;
  projectName?: string;
  projectGoal?: string;
  purpose?: string;
  problem?: string;
  targetUsers: string[];
  confirmedRequirements: string[];
  functionalRequirements: string[];
  nonFunctionalRequirements: string[];
  designRequirements: string[];
  integrations: string[];
  securityRequirements: string[];
  businessRules: string[];
  inferredRequirements: string[];
  rejectedRequirements: string[];
  unresolvedQuestions: string[];
  constraints: string[];
  decisions: string[];
  corrections: string[];
  dependencies: string[];
  acceptanceCriteria: string[];
  readiness: ProjectReadiness;
  approvedVersion?: number;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ProjectSpecification {
  projectId: string;
  ownerId: string;
  projectName?: string;
  projectGoal?: string;
  purpose?: string;
  problem?: string;
  targetUsers: string[];
  confirmedRequirements: string[];
  functionalRequirements: string[];
  nonFunctionalRequirements: string[];
  designRequirements: string[];
  integrations: string[];
  securityRequirements: string[];
  businessRules: string[];
  constraints: string[];
  decisions: string[];
  unresolvedQuestions: string[];
  inferredRequirements: string[];
  rejectedRequirements: string[];
  dependencies: string[];
  acceptanceCriteria: string[];
  readiness: ProjectReadiness;
  approvedVersion?: number;
  version: number;
}

export interface BuilderHandoff {
  contractVersion: '1';
  handoffId: string;
  projectId: string;
  ownerApprovalVersion: number;
  projectName?: string;
  objective?: string;
  projectGoal?: string;
  purpose?: string;
  problem?: string;
  targetUsers: string[];
  confirmedRequirements: string[];
  functionalRequirements: string[];
  nonFunctionalRequirements: string[];
  designRequirements: string[];
  integrations: string[];
  securityRequirements: string[];
  privacyRequirements: string[];
  businessRules: string[];
  constraints: string[];
  decisions: string[];
  dependencies: string[];
  acceptanceCriteria: string[];
  unresolvedQuestions: string[];
  rejectedRequirements: string[];
  specificationVersion: number;
  approvedAt: string;
  requestedBy: 'owner';
  representedBy: 'kc-robot';
  handoffStatus: 'BUILD_AUTHORIZED';
  decisionPolicy: {
    normal: 'NORMAL_DEVELOPMENT';
    sensitive: 'SENSITIVE_OWNER_REQUIRED';
    normalExamples: string[];
    sensitiveExamples: string[];
  };
}