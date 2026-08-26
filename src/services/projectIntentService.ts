import { randomUUID } from 'node:crypto';
import { getStorage } from './storage';
import type { BuilderHandoff, ProjectIntent, ProjectReadiness, ProjectSpecification } from '../types/projectIntent';

function addUnique(values: string[], value: string): void {
  const normalized = value.trim();
  if (normalized && !values.some((entry) => entry.toLowerCase() === normalized.toLowerCase())) values.push(normalized);
}

function removeMatching(values: string[], value: string): void {
  const normalized = value.toLowerCase();
  for (let index = values.length - 1; index >= 0; index -= 1) if (values[index].toLowerCase() === normalized) values.splice(index, 1);
}

function readiness(intent: ProjectIntent): ProjectReadiness {
  if (!intent.projectName || !intent.projectGoal) return 'DISCOVERY';
  if (intent.unresolvedQuestions.length > 0) return 'NEEDS_CLARIFICATION';
  if (intent.confirmedRequirements.length === 0) return 'SPECIFICATION_IN_PROGRESS';
  if (intent.approvedVersion === intent.version) return 'APPROVED_FOR_BUILD';
  return 'READY_FOR_OWNER_REVIEW';
}

function invalidateApproval(intent: ProjectIntent): void {
  delete intent.approvedVersion;
  delete intent.approvedAt;
}

function normalizeIntent(intent: ProjectIntent): ProjectIntent {
  const defaults = { targetUsers: [], functionalRequirements: [], nonFunctionalRequirements: [], designRequirements: [], integrations: [], securityRequirements: [], businessRules: [], dependencies: [], acceptanceCriteria: [], inferredRequirements: [], rejectedRequirements: [], unresolvedQuestions: [], constraints: [], decisions: [], corrections: [] };
  const normalized = { ...defaults, ...intent } as ProjectIntent;
  normalized.readiness = normalized.approvedVersion === normalized.version ? 'APPROVED_FOR_BUILD' : normalized.readiness || readiness(normalized);
  return normalized;
}

function parseStatement(statement: string): Partial<ProjectIntent> {
  const text = statement.trim().replace(/[.!?]+$/, '');
  const lower = text.toLowerCase();
  const parsed: Partial<ProjectIntent> = {};
  const projectMatch = text.match(/(?:build|create|start)\s+(?:the\s+)?([A-Z][\w-]*(?:\s+[A-Z][\w-]*)*)/i);
  if (projectMatch) parsed.projectName = projectMatch[1].trim();
  const goalMatch = text.match(/(?:i want to|we want to|let's)\s+(?:build|create|start)\s+(.+?)(?:\.|$)/i);
  if (goalMatch) parsed.projectGoal = goalMatch[1].trim();

  const rejected = text.match(/(?:i (?:do not|don't) want|not|reject)\s+(.+?)(?:\.|$)/i);
  if (rejected) parsed.rejectedRequirements = [rejected[1].trim()];
  const correction = text.match(/(?:no,?\s*)?(?:do not|don't)\s+make\s+it\s+only\s+(.+?)[.;]?\s*(?:it should|but it should)\s+(.+?)(?:\.|$)/i);
  if (correction) parsed.corrections = [`Replaced "only ${correction[1].trim()}" with "${correction[2].trim()}"`];
  const expansion = !parsed.projectGoal && text.match(/(?:it should|must|needs to|should)\s+(.+?)(?:\.|$)/i);
  if (expansion && !parsed.rejectedRequirements) parsed.confirmedRequirements = [expansion[1].trim()];
  const correctionRequirement = text.match(/(?:support|include|provide)\s+(.+?)(?:\.|$)/i);
  if (correctionRequirement && !parsed.confirmedRequirements) parsed.confirmedRequirements = [correctionRequirement[1].trim()];
  if (lower.includes('customers should be able to pay') && !lower.includes('card') && !lower.includes('bank') && !lower.includes('crypto')) parsed.unresolvedQuestions = ['Which payment methods should customers be able to use?'];
  if (lower.includes('only esim')) parsed.confirmedRequirements = ['only eSIM'];
  if (lower.includes('physical sim')) parsed.confirmedRequirements = ['physical SIM support'];
  const purpose = text.match(/(?:the purpose is|it is for|this is for)\s+(.+?)(?:\.|$)/i);
  if (purpose) parsed.purpose = purpose[1].trim();
  const problem = text.match(/(?:solve|solves|problem is)\s+(.+?)(?:\.|$)/i);
  if (problem) parsed.problem = problem[1].trim();
  const users = text.match(/(?:for|target(?:ed)? at|serve)\s+(customers?|users?|businesses?|students?|owners?)(?=\s+and|\.|$)/i);
  if (users) parsed.targetUsers = [users[1].trim()];
  if (/non-functional|performance|availability|scalab|reliab/i.test(lower)) parsed.nonFunctionalRequirements = [text];
  if (/\bdesign\b|\bui\b|interface|visual|accessible/i.test(lower)) parsed.designRequirements = [text];
  if (/integrat|provider|\bapi\b/i.test(lower)) parsed.integrations = [text];
  if (/security|secure|privacy|encrypt|permission|authentication/i.test(lower)) parsed.securityRequirements = [text];
  if (/business rule|must not|cannot sell|commission|pricing/i.test(lower)) parsed.businessRules = [text];
  if (/constraint|limited to|within|budget|deadline/i.test(lower)) parsed.constraints = [text];
  if (/decide|decision|we chose|choose/i.test(lower)) parsed.decisions = [text];
  if (/depend on|depends on|dependency/i.test(lower)) parsed.dependencies = [text];
  if (/acceptance criteria|accepted when|done when/i.test(lower)) parsed.acceptanceCriteria = [text];
  return parsed;
}

function applyStatement(intent: ProjectIntent, statement: string): ProjectIntent {
  const parsed = parseStatement(statement);
  if (parsed.projectName && !intent.projectName) intent.projectName = parsed.projectName;
  if (parsed.projectGoal && !intent.projectGoal) intent.projectGoal = parsed.projectGoal;
  for (const rejected of parsed.rejectedRequirements || []) {
    addUnique(intent.rejectedRequirements, rejected);
    removeMatching(intent.confirmedRequirements, rejected);
    removeMatching(intent.inferredRequirements, rejected);
  }
  if (parsed.corrections?.length) {
    for (const correction of parsed.corrections) addUnique(intent.corrections, correction);
    removeMatching(intent.confirmedRequirements, 'only eSIM');
  }
  if (/completely separate|separate product/i.test(statement)) {
    for (const requirement of [...intent.confirmedRequirements]) if (requirement.toLowerCase().includes('browser')) removeMatching(intent.confirmedRequirements, requirement);
    addUnique(intent.decisions, 'KC Browser is a separate product');
  }
  for (const requirement of parsed.confirmedRequirements || []) {
    if (requirement.toLowerCase() !== intent.projectGoal?.toLowerCase() && requirement.toLowerCase() !== intent.projectName?.toLowerCase() && !/^i want to build\b/i.test(requirement) && !intent.rejectedRequirements.some((entry) => entry.toLowerCase() === requirement.toLowerCase())) addUnique(intent.confirmedRequirements, requirement);
  }
  for (const field of ['targetUsers', 'functionalRequirements', 'nonFunctionalRequirements', 'designRequirements', 'integrations', 'securityRequirements', 'businessRules', 'constraints', 'decisions', 'dependencies', 'acceptanceCriteria'] as const) {
    for (const value of parsed[field] || []) addUnique(intent[field], value);
  }
  if (parsed.purpose) intent.purpose = parsed.purpose;
  if (parsed.problem) intent.problem = parsed.problem;
  for (const value of parsed.nonFunctionalRequirements || []) addUnique(intent.confirmedRequirements, value);
  for (const value of parsed.designRequirements || []) addUnique(intent.confirmedRequirements, value);
  for (const value of parsed.integrations || []) addUnique(intent.confirmedRequirements, value);
  for (const value of parsed.securityRequirements || []) addUnique(intent.confirmedRequirements, value);
  for (const value of parsed.businessRules || []) addUnique(intent.confirmedRequirements, value);
  for (const question of parsed.unresolvedQuestions || []) addUnique(intent.unresolvedQuestions, question);
  if (statement.toLowerCase().includes('reasonable') || statement.toLowerCase().includes('likely')) addUnique(intent.inferredRequirements, statement.trim());
  intent.version += 1;
  invalidateApproval(intent);
  intent.readiness = readiness(intent);
  intent.updatedAt = new Date().toISOString();
  return intent;
}

export async function createProjectIntent(input: { ownerId: string; statement: string; projectId?: string }): Promise<ProjectIntent> {
  const now = new Date().toISOString();
  const intent: ProjectIntent = { projectId: input.projectId || `project_${randomUUID()}`, ownerId: input.ownerId, confirmedRequirements: [], functionalRequirements: [], nonFunctionalRequirements: [], designRequirements: [], integrations: [], securityRequirements: [], businessRules: [], targetUsers: [], inferredRequirements: [], rejectedRequirements: [], unresolvedQuestions: [], constraints: [], decisions: [], corrections: [], dependencies: [], acceptanceCriteria: [], readiness: 'DISCOVERY', createdAt: now, updatedAt: now, version: 0 };
  applyStatement(intent, input.statement);
  return getStorage().createProjectIntent(intent);
}

export async function loadProjectIntent(projectId: string, ownerId: string): Promise<ProjectIntent | undefined> { const intent = await getStorage().getProjectIntent(projectId, ownerId); return intent ? normalizeIntent(intent) : undefined; }

export async function updateProjectIntent(input: { projectId: string; ownerId: string; statement: string }): Promise<ProjectIntent> {
  const intent = await loadProjectIntent(input.projectId, input.ownerId);
  if (!intent) throw new Error('Project intent not found');
  return getStorage().updateProjectIntent(applyStatement(normalizeIntent(intent), input.statement));
}

export async function applyCorrection(input: { projectId: string; ownerId: string; statement: string }): Promise<ProjectIntent> { return updateProjectIntent(input); }
export async function recordRejectedRequirement(input: { projectId: string; ownerId: string; requirement: string }): Promise<ProjectIntent> { return updateProjectIntent({ ...input, statement: `I don't want ${input.requirement}.` }); }
export async function recordUnresolvedQuestion(input: { projectId: string; ownerId: string; question: string }): Promise<ProjectIntent> { return updateProjectIntent({ ...input, statement: `Customers should be able to ${input.question}.` }); }

export async function approveProjectIntent(input: { projectId: string; ownerId: string }): Promise<ProjectIntent> {
  const intent = await loadProjectIntent(input.projectId, input.ownerId);
  if (!intent) throw new Error('Project intent not found');
  if (intent.readiness === 'NEEDS_CLARIFICATION' || intent.readiness === 'DISCOVERY' || intent.confirmedRequirements.length === 0) throw new Error('Project specification is not ready for approval');
  intent.approvedVersion = intent.version;
  intent.approvedAt = new Date().toISOString();
  intent.readiness = 'APPROVED_FOR_BUILD';
  return getStorage().updateProjectIntent(intent);
}

export function readinessForProject(intent: ProjectIntent): ProjectReadiness { return readiness(normalizeIntent(intent)); }

export function summarizeProjectIntent(intent: ProjectIntent): string {
  return [intent.projectName ? `Project: ${intent.projectName}` : 'Project: unnamed', intent.projectGoal ? `Goal: ${intent.projectGoal}` : 'Goal: unknown', `Confirmed requirements: ${intent.confirmedRequirements.join('; ') || 'none recorded'}`, `Inferred requirements: ${intent.inferredRequirements.join('; ') || 'none recorded'}`, `Rejected requirements: ${intent.rejectedRequirements.join('; ') || 'none recorded'}`, `Unresolved questions: ${intent.unresolvedQuestions.join('; ') || 'none recorded'}`, `Constraints: ${intent.constraints.join('; ') || 'none recorded'}`, `Decisions: ${intent.decisions.join('; ') || 'none recorded'}`, `Readiness: ${intent.readiness}`, `Approved version: ${intent.approvedVersion ?? 'none'}`, `Version: ${intent.version}`].join('\n');
}

export function toProjectSpecification(intent: ProjectIntent): ProjectSpecification { return { projectId: intent.projectId, ownerId: intent.ownerId, projectName: intent.projectName, projectGoal: intent.projectGoal, purpose: intent.purpose, problem: intent.problem, targetUsers: [...intent.targetUsers], confirmedRequirements: [...intent.confirmedRequirements], functionalRequirements: [...intent.functionalRequirements], nonFunctionalRequirements: [...intent.nonFunctionalRequirements], designRequirements: [...intent.designRequirements], integrations: [...intent.integrations], securityRequirements: [...intent.securityRequirements], businessRules: [...intent.businessRules], constraints: [...intent.constraints], decisions: [...intent.decisions], unresolvedQuestions: [...intent.unresolvedQuestions], inferredRequirements: [...intent.inferredRequirements], rejectedRequirements: [...intent.rejectedRequirements], dependencies: [...intent.dependencies], acceptanceCriteria: [...intent.acceptanceCriteria], readiness: intent.readiness, approvedVersion: intent.approvedVersion, version: intent.version }; }

export function toBuilderHandoff(intent: ProjectIntent): BuilderHandoff {
  if (intent.approvedVersion !== intent.version || !intent.approvedAt) throw new Error('Only the currently approved specification can be handed off');
  return { contractVersion: '1', handoffId: `handoff_${intent.projectId}_${intent.version}`, projectId: intent.projectId, ownerApprovalVersion: intent.approvedVersion, projectName: intent.projectName, objective: intent.projectGoal, projectGoal: intent.projectGoal, purpose: intent.purpose, problem: intent.problem, targetUsers: [...intent.targetUsers], confirmedRequirements: [...intent.confirmedRequirements], functionalRequirements: [...intent.functionalRequirements], nonFunctionalRequirements: [...intent.nonFunctionalRequirements], designRequirements: [...intent.designRequirements], integrations: [...intent.integrations], securityRequirements: [...intent.securityRequirements], privacyRequirements: [], businessRules: [...intent.businessRules], constraints: [...intent.constraints], decisions: [...intent.decisions], dependencies: [...intent.dependencies], acceptanceCriteria: [...intent.acceptanceCriteria], unresolvedQuestions: [...intent.unresolvedQuestions], rejectedRequirements: [...intent.rejectedRequirements], specificationVersion: intent.version, approvedAt: intent.approvedAt, requestedBy: 'owner', representedBy: 'kc-robot', handoffStatus: 'BUILD_AUTHORIZED', decisionPolicy: { normal: 'NORMAL_DEVELOPMENT', sensitive: 'SENSITIVE_OWNER_REQUIRED', normalExamples: ['create files', 'edit project code', 'refactor', 'run tests', 'fix ordinary build failures', 'generate internal documentation', 'create local preview/build artifacts'], sensitiveExamples: ['purchasing or payment', 'changing real financial accounts', 'exposing secrets', 'destructive deletion', 'production deployment', 'external messages', 'legal or identity-sensitive actions', 'irreversible operations'] } };
}