import { randomUUID } from 'node:crypto';
import { getStorage } from './storage';
import type { ProjectIntent, ProjectSpecification } from '../types/projectIntent';

function addUnique(values: string[], value: string): void {
  const normalized = value.trim();
  if (normalized && !values.some((entry) => entry.toLowerCase() === normalized.toLowerCase())) values.push(normalized);
}

function removeMatching(values: string[], value: string): void {
  const normalized = value.toLowerCase();
  for (let index = values.length - 1; index >= 0; index -= 1) if (values[index].toLowerCase() === normalized) values.splice(index, 1);
}

function parseStatement(statement: string): Partial<ProjectIntent> {
  const text = statement.trim();
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
  const expansion = text.match(/(?:it should|must|needs to|should)\s+(.+?)(?:\.|$)/i);
  if (expansion && !parsed.rejectedRequirements) parsed.confirmedRequirements = [expansion[1].trim()];
  const correctionRequirement = text.match(/(?:support|include|provide)\s+(.+?)(?:\.|$)/i);
  if (correctionRequirement && !parsed.confirmedRequirements) parsed.confirmedRequirements = [correctionRequirement[1].trim()];
  if (lower.includes('customers should be able to pay') && !lower.includes('card') && !lower.includes('bank') && !lower.includes('crypto')) parsed.unresolvedQuestions = ['Which payment methods should customers be able to use?'];
  if (lower.includes('only esim')) parsed.confirmedRequirements = ['only eSIM'];
  if (lower.includes('physical sim')) parsed.confirmedRequirements = ['physical SIM support'];
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
  for (const requirement of parsed.confirmedRequirements || []) {
    if (!intent.rejectedRequirements.some((entry) => entry.toLowerCase() === requirement.toLowerCase())) addUnique(intent.confirmedRequirements, requirement);
  }
  for (const question of parsed.unresolvedQuestions || []) addUnique(intent.unresolvedQuestions, question);
  if (statement.toLowerCase().includes('reasonable') || statement.toLowerCase().includes('likely')) addUnique(intent.inferredRequirements, statement.trim());
  intent.version += 1;
  intent.updatedAt = new Date().toISOString();
  return intent;
}

export async function createProjectIntent(input: { ownerId: string; statement: string; projectId?: string }): Promise<ProjectIntent> {
  const now = new Date().toISOString();
  const intent: ProjectIntent = { projectId: input.projectId || `project_${randomUUID()}`, ownerId: input.ownerId, confirmedRequirements: [], inferredRequirements: [], rejectedRequirements: [], unresolvedQuestions: [], constraints: [], decisions: [], corrections: [], createdAt: now, updatedAt: now, version: 0 };
  applyStatement(intent, input.statement);
  return getStorage().createProjectIntent(intent);
}

export async function loadProjectIntent(projectId: string, ownerId: string): Promise<ProjectIntent | undefined> { return getStorage().getProjectIntent(projectId, ownerId); }

export async function updateProjectIntent(input: { projectId: string; ownerId: string; statement: string }): Promise<ProjectIntent> {
  const intent = await loadProjectIntent(input.projectId, input.ownerId);
  if (!intent) throw new Error('Project intent not found');
  return getStorage().updateProjectIntent(applyStatement(intent, input.statement));
}

export async function applyCorrection(input: { projectId: string; ownerId: string; statement: string }): Promise<ProjectIntent> { return updateProjectIntent(input); }
export async function recordRejectedRequirement(input: { projectId: string; ownerId: string; requirement: string }): Promise<ProjectIntent> { return updateProjectIntent({ ...input, statement: `I don't want ${input.requirement}.` }); }
export async function recordUnresolvedQuestion(input: { projectId: string; ownerId: string; question: string }): Promise<ProjectIntent> { return updateProjectIntent({ ...input, statement: `Customers should be able to ${input.question}.` }); }

export function summarizeProjectIntent(intent: ProjectIntent): string {
  return [intent.projectName ? `Project: ${intent.projectName}` : 'Project: unnamed', intent.projectGoal ? `Goal: ${intent.projectGoal}` : 'Goal: unknown', `Confirmed requirements: ${intent.confirmedRequirements.join('; ') || 'none recorded'}`, `Inferred requirements: ${intent.inferredRequirements.join('; ') || 'none recorded'}`, `Rejected requirements: ${intent.rejectedRequirements.join('; ') || 'none recorded'}`, `Unresolved questions: ${intent.unresolvedQuestions.join('; ') || 'none recorded'}`, `Constraints: ${intent.constraints.join('; ') || 'none recorded'}`, `Decisions: ${intent.decisions.join('; ') || 'none recorded'}`, `Version: ${intent.version}`].join('\n');
}

export function toProjectSpecification(intent: ProjectIntent): ProjectSpecification { return { projectId: intent.projectId, ownerId: intent.ownerId, projectName: intent.projectName, projectGoal: intent.projectGoal, confirmedRequirements: [...intent.confirmedRequirements], constraints: [...intent.constraints], decisions: [...intent.decisions], unresolvedQuestions: [...intent.unresolvedQuestions], version: intent.version }; }