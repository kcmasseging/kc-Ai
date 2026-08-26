export interface ProjectIntent {
  projectId: string;
  ownerId: string;
  projectName?: string;
  projectGoal?: string;
  confirmedRequirements: string[];
  inferredRequirements: string[];
  rejectedRequirements: string[];
  unresolvedQuestions: string[];
  constraints: string[];
  decisions: string[];
  corrections: string[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ProjectSpecification {
  projectId: string;
  ownerId: string;
  projectName?: string;
  projectGoal?: string;
  confirmedRequirements: string[];
  constraints: string[];
  decisions: string[];
  unresolvedQuestions: string[];
  version: number;
}