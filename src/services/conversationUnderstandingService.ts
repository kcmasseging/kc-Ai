import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getStorage } from './storage';
import { applyCorrection, createProjectIntent, loadProjectIntent, recordRejectedRequirement, updateProjectIntent } from './projectIntentService';
import type { ConversationRecord, Confidence, InterpretationKind } from '../types/conversation';
import type { ProjectIntent } from '../types/projectIntent';

const InterpretationSchema = z.object({
  kind: z.enum(['new-project', 'addition', 'correction', 'rejection', 'constraint', 'decision', 'question', 'unresolved', 'project-switch', 'ordinary']),
  confidence: z.enum(['HIGH', 'INFERRED', 'AMBIGUOUS']),
  projectName: z.string().optional(),
  requirement: z.string().optional(),
  target: z.string().optional(),
  response: z.string().optional(),
});
export type Interpretation = z.infer<typeof InterpretationSchema>;

function clean(value: string): string { return value.trim().replace(/[.!?]+$/, ''); }
function projectNameFrom(text: string): string | undefined {
  const match = text.match(/(?:build|create|start|discuss|go back to)\s+(?:the\s+)?([A-Z][\w-]*(?:\s+[A-Z][\w-]*)*)/i);
  return match ? clean(match[1]) : undefined;
}
function sameProject(a: string | undefined, b: string | undefined): boolean { return Boolean(a && b && a.toLowerCase() === b.toLowerCase()); }

export function interpretOwnerMessage(message: string, conversation?: ConversationRecord, projects: ProjectIntent[] = []): Interpretation {
  const text = clean(message);
  const lower = text.toLowerCase();
  const namedProject = projectNameFrom(text);
  const knownProject = namedProject ? projects.find((project) => sameProject(project.projectName, namedProject)) : undefined;
  if (namedProject && /\b(?:build|create|start|discuss|go back to)\b/i.test(text)) return InterpretationSchema.parse({ kind: 'project-switch', confidence: 'HIGH', projectName: knownProject?.projectName || namedProject });
  if (/^i want to build\b/i.test(text) || /^let's build\b/i.test(text)) return InterpretationSchema.parse({ kind: 'new-project', confidence: 'HIGH', projectName: namedProject || clean(text.replace(/^i want to build\s+/i, '')) });
  if (/^(?:can|could|would|will|is|does|do)\b/i.test(text) || /\?$/.test(message)) return InterpretationSchema.parse({ kind: 'question', confidence: 'HIGH', requirement: text });
  if (/^(?:no|actually|forget|i changed my mind|keep .* but remove)\b/i.test(text)) {
    if (/not\s+(?:make it\s+)?(?:eSIM|only eSIM)\s+only/i.test(text)) return InterpretationSchema.parse({ kind: 'correction', confidence: 'HIGH', target: 'eSIM', requirement: 'It should support physical SIM.' });
    if (/completely separate|separate product/i.test(text)) return InterpretationSchema.parse({ kind: 'correction', confidence: 'HIGH', target: 'browser', requirement: 'KC Browser is a separate product.' });
    const target = lower.includes('remove that') || lower.includes('forget that') ? undefined : clean(text.replace(/^no,?\s*/i, ''));
    return InterpretationSchema.parse({ kind: target ? 'correction' : 'correction', confidence: target ? 'HIGH' : 'AMBIGUOUS', target, requirement: target });
  }
  if (/^(?:remove|delete|drop)\s+that\b/i.test(text)) return InterpretationSchema.parse({ kind: 'rejection', confidence: 'AMBIGUOUS' });
  if (/^yes\b/i.test(text) || /^add it\b/i.test(lower)) {
    const proposal = conversation?.recentProposal;
    return InterpretationSchema.parse(proposal ? { kind: 'addition', confidence: 'HIGH', requirement: proposal } : { kind: 'addition', confidence: 'AMBIGUOUS' });
  }
  if (/\b(?:don't|do not|never|not)\s+(?:want|support|use|make)\b/i.test(text) || /^no cryptocurrency/i.test(text)) return InterpretationSchema.parse({ kind: 'rejection', confidence: 'HIGH', requirement: clean(text.replace(/^i (?:don't|do not) want\s+/i, '').replace(/^no\s+/i, '')) });
  if (/\b(?:only|must|cannot|can't|should not|need to|needs to)\b/i.test(lower)) return InterpretationSchema.parse({ kind: lower.includes('only') ? 'constraint' : 'decision', confidence: 'HIGH', requirement: text });
  if (/\b(?:should|want|need|support|include|provide|sell|offer|have|add)\b/i.test(lower)) return InterpretationSchema.parse({ kind: 'addition', confidence: 'HIGH', requirement: text.replace(/^(?:and|also)\s+/i, '') });
  if (conversation?.activeProjectId) return InterpretationSchema.parse({ kind: 'ordinary', confidence: 'INFERRED' });
  return InterpretationSchema.parse({ kind: 'ordinary', confidence: 'AMBIGUOUS' });
}

function findRequirement(intent: ProjectIntent, target: string | undefined): string[] {
  if (!target) return [];
  const values = [...intent.confirmedRequirements, ...intent.rejectedRequirements];
  return values.filter((value) => value.toLowerCase().includes(target.toLowerCase()) || target.toLowerCase().includes(value.toLowerCase()));
}

function intentStatement(requirement: string): string {
  const value = requirement.replace(/^(?:and|also)\s+/i, '').trim();
  return `It should ${value.replace(/^i want\s+/i, '').replace(/^people should be able to\s+/i, '')}`;
}

function initialConversation(ownerId: string, sessionId: string): ConversationRecord { return { conversationId: `conversation_${randomUUID()}`, ownerId, sessionId, messages: [], updatedAt: new Date().toISOString() }; }

export interface UnderstandingResponse { reply: string; sessionId: string; activeProjectId?: string; interpretation: Interpretation; intent?: ProjectIntent; }

export async function understandOwnerMessage(input: { ownerId: string; sessionId: string; message: string }): Promise<UnderstandingResponse> {
  const storage = getStorage();
  const conversation = (await storage.getConversation(input.ownerId, input.sessionId)) || initialConversation(input.ownerId, input.sessionId);
  const projects = await storage.listProjectIntents(input.ownerId);
  const interpretation = interpretOwnerMessage(input.message, conversation, projects);
  let intent: ProjectIntent | undefined;
  let reply: string;
  let activeProjectId = conversation.activeProjectId;
  if (interpretation.kind === 'new-project') {
    intent = await createProjectIntent({ ownerId: input.ownerId, statement: `I want to build ${interpretation.projectName}.` });
    activeProjectId = intent.projectId;
    reply = `Got it. We are discussing ${intent.projectName || 'this project'}. What should it do?`;
  } else if (interpretation.kind === 'project-switch') {
    const target = projects.find((project) => sameProject(project.projectName, interpretation.projectName));
    if (target) { intent = target; activeProjectId = target.projectId; reply = `We are back in the ${target.projectName} project. What would you like to change?`; }
    else if (interpretation.projectName) { intent = await createProjectIntent({ ownerId: input.ownerId, statement: `I want to build ${interpretation.projectName}.` }); activeProjectId = intent.projectId; reply = `Understood. I have opened ${intent.projectName} as a separate project. What should it do?`; }
    else { reply = 'Which project would you like to discuss?'; }
  } else if (!activeProjectId) {
    reply = interpretation.kind === 'ordinary' ? 'Which project should I associate this with?' : 'Which project should I apply that to?';
    interpretation.confidence = 'AMBIGUOUS';
  } else {
    intent = await loadProjectIntent(activeProjectId, input.ownerId);
    if (!intent) { activeProjectId = undefined; reply = 'Which project should I associate this with?'; }
    else if (interpretation.confidence === 'AMBIGUOUS') reply = 'I want to make sure I change the right thing. Which requirement or project are you referring to?';
    else if (interpretation.kind === 'question') { conversation.recentProposal = interpretation.requirement?.replace(/^(?:can|could|would|will|is|does|do)\s+(?:it|the project)\s+(?:support|include|have)\s+/i, '') || interpretation.requirement; reply = `That is a question about ${intent.projectName || 'the project'}, not a decision yet. Should I add it as a requirement?`; }
    else if (interpretation.kind === 'rejection') {
      const matches = findRequirement(intent, interpretation.requirement);
      if (matches.length > 1 || (!interpretation.requirement && matches.length !== 1)) reply = 'Which requirement should I remove?';
      else { const requirement = matches[0] || interpretation.requirement as string; intent = await recordRejectedRequirement({ projectId: intent.projectId, ownerId: input.ownerId, requirement }); reply = `Understood. I will leave ${requirement} out of the project.`; }
    } else if (interpretation.kind === 'correction') {
      const matches = findRequirement(intent, interpretation.target);
      if (!interpretation.requirement || (interpretation.target && matches.length !== 1)) reply = 'What specifically would you like me to correct?';
      else {
        const correction = /physical\s+sim/i.test(input.message) ? 'It should support physical SIM.' : intentStatement(interpretation.requirement || input.message);
        intent = await applyCorrection({ projectId: intent.projectId, ownerId: input.ownerId, statement: correction });
        reply = `Got it. I updated the ${intent.projectName || 'project'} understanding.`;
      }
    } else if (interpretation.kind === 'addition' || interpretation.kind === 'constraint' || interpretation.kind === 'decision') {
      const statement = interpretation.requirement || input.message;
      intent = await updateProjectIntent({ projectId: intent.projectId, ownerId: input.ownerId, statement: statement.startsWith('It should') ? statement : intentStatement(statement) });
      reply = `Got it. I added that to the ${intent.projectName || 'project'} understanding.`;
      if (input.message.toLowerCase().includes('payment')) { reply += ' Which payment methods do you want to support?'; intent = await updateProjectIntent({ projectId: intent.projectId, ownerId: input.ownerId, statement: 'Customers should be able to pay.' }); }
    } else reply = 'I am listening. What would you like to decide about this project?';
  }
  const now = new Date().toISOString();
  conversation.activeProjectId = activeProjectId;
  conversation.messages.push({ role: 'owner', content: input.message, projectId: activeProjectId, createdAt: now }, { role: 'assistant', content: reply, projectId: activeProjectId, createdAt: now });
  conversation.updatedAt = now;
  await storage.saveConversation(conversation);
  return { reply, sessionId: input.sessionId, activeProjectId, interpretation, intent };
}

export function projectReadiness(intent: ProjectIntent): 'NOT_READY' | 'NEEDS_CLARIFICATION' | 'READY_FOR_SPECIFICATION' {
  if (!intent.projectName || !intent.projectGoal) return 'NOT_READY';
  if (intent.confirmedRequirements.length === 0) return 'NEEDS_CLARIFICATION';
  if (intent.unresolvedQuestions.length > 0 || intent.confirmedRequirements.length === 0) return 'NEEDS_CLARIFICATION';
  return 'READY_FOR_SPECIFICATION';
}