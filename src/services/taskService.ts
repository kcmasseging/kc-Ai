import { randomUUID } from 'node:crypto';
import { checkCapability } from './capabilityService';
import { recordAudit } from './auditService';
import { getStorage } from './storage';
import type { TaskRecord } from '../types/task';

function inferCapability(goal: string): string {
  const normalized = goal.toLowerCase();
  if (/\b(send|sending|email|e-mail)\b/.test(normalized) && /\b(email|e-mail)\b/.test(normalized)) return 'email.send';
  if (/\b(send|sending|message|messaging|text|sms|notify|notification)\b/.test(normalized)) return 'message.send';
  if (/\b(pay|payment|payments|transfer|transfers|wire|refund|purchase|charge)\b/.test(normalized)) return 'payment.transfer';
  if (/\b(deploy|deployment|publish|publishing|release|ship)\b/.test(normalized)) return 'deployment.execute';
  if (/\b(delete|deletion|remove|removal|erase|destroy)\b/.test(normalized) && /\b(file|files|folder|folders|record|records|data)\b/.test(normalized)) return 'file.delete';
  if (/\b(search|browse|look up|lookup)\b/.test(normalized) && /\b(web|internet|online)\b/.test(normalized)) return 'web.search';
  if (/\b(private build|private development|staging build)\b/.test(normalized)) return 'owner.private-build';
  if (/\b(change|update|modify|edit|create|close|delete|reset)\b/.test(normalized) && /\b(account|profile|password|subscription|settings|permissions|user)\b/.test(normalized)) return 'account.changes';
  if (/\b(api|webhook|external service|third-party|third party|integration)\b/.test(normalized)) return 'external-api.action';
  if (normalized.includes('database') || normalized.includes('product data')) return 'kc-product-data';
  return 'task.orchestration';
}

function understand(goal: string, capability: string): TaskRecord['understanding'] {
  const targetMatch = goal.match(/\b(?:to|for|in)\s+([^,.]+?)(?:\s+(?:saying|with|using)\b|[,\.]|$)/i);
  return {
    requestedAction: capability === 'task.orchestration' ? 'Analyze and organize the supplied task' : `Perform the requested ${capability} action`,
    target: targetMatch?.[1]?.trim(),
    parameters: { goal },
    externalSideEffect: capability !== 'task.orchestration' && !capability.startsWith('internal.'),
  };
}

export async function createAndAdvanceTask(input: {
  goal: string;
  privateBuildId?: string;
  appId?: string;
  appName?: string;
  actorRole?: 'system' | 'user' | 'owner';
  executeInternal?: () => Promise<string | undefined> | string | undefined;
  verifyInternal?: (evidence: string) => Promise<string | undefined> | string | undefined;
}): Promise<TaskRecord> {
  const now = new Date().toISOString();
  const task: TaskRecord = {
    taskId: `task_${randomUUID()}`,
    goal: input.goal.trim(),
    privateBuildId: input.privateBuildId,
    appContext: input.appId || input.appName ? { appId: input.appId, appName: input.appName } : undefined,
    status: 'created',
    createdAt: now,
    updatedAt: now,
    progress: ['Task created.'],
    verificationStatus: 'not-verified',
  };
  await getStorage().createTask(task);
  await recordAudit({ actionType: 'task.received', taskId: task.taskId, actorRole: input.actorRole || 'user', outcome: 'started', verificationStatus: 'not-verified' });

  task.requiredCapability = inferCapability(task.goal);
  task.understanding = understand(task.goal, task.requiredCapability);
  task.status = 'classified';
  task.progress.push(`Classified as ${task.requiredCapability}.`);
  await getStorage().updateTask(task);
  task.status = 'planned';
  task.progress.push('Execution plan created.');
  task.executionPlan = {
    taskId: task.taskId,
    requiredCapability: task.requiredCapability,
    intendedAction: task.understanding?.requestedAction || 'Perform the classified task',
    expectedResult: task.requiredCapability === 'task.orchestration' ? 'A structured internal task result' : 'The requested external side effect',
    validationRequirement: 'A real execution result must be available before completion',
  };
  await getStorage().updateTask(task);
  const capability = checkCapability(task.requiredCapability);

  if (capability.status !== 'available' || (capability.requiresOwner && input.actorRole !== 'owner')) {
    task.status = 'blocked';
    task.blockedReason = capability.requiresOwner && input.actorRole !== 'owner'
      ? 'Owner authorization is required for this capability'
      : capability.reason || `Capability status: ${capability.status}`;
    task.progress.push(`Blocked: ${task.blockedReason}.`);
    task.lastError = task.blockedReason;
    task.updatedAt = new Date().toISOString();
    await getStorage().updateTask(task);
    await recordAudit({ actionType: 'task.blocked', taskId: task.taskId, actorRole: input.actorRole || 'user', outcome: 'blocked', verificationStatus: 'not-verified', error: task.blockedReason, capabilityUsed: task.requiredCapability, lifecycleTransitions: ['created', 'classified', 'planned', 'blocked'].map((state) => ({ state, timestamp: task.updatedAt, evidence: state === 'blocked' ? task.blockedReason : task.requiredCapability })) });
    return { ...task, progress: [...task.progress] };
  }

  if (task.requiredCapability !== 'task.orchestration') {
    task.status = 'blocked';
    task.blockedReason = 'Capability is registered but has no executable adapter';
    task.lastError = task.blockedReason;
    task.progress.push(`Blocked: ${task.blockedReason}.`);
    task.updatedAt = new Date().toISOString();
    await getStorage().updateTask(task);
    await recordAudit({ actionType: 'task.blocked', taskId: task.taskId, actorRole: input.actorRole || 'user', outcome: 'blocked', verificationStatus: 'not-verified', error: task.blockedReason, capabilityUsed: task.requiredCapability, lifecycleTransitions: ['created', 'classified', 'planned', 'blocked'].map((state) => ({ state, timestamp: task.updatedAt, evidence: state === 'blocked' ? task.blockedReason : task.requiredCapability })) });
    return { ...task, progress: [...task.progress] };
  }

  task.status = 'executing';
  task.progress.push('Internal task execution started.');
  try {
    task.executionEvidence = input.executeInternal
      ? await input.executeInternal()
      : 'Internal task state and supplied goal were processed by KC AI.';
  } catch (error) {
    task.status = 'failed';
    task.lastError = error instanceof Error ? error.message : 'Internal task execution failed';
    task.progress.push(`Failed: ${task.lastError}.`);
    task.updatedAt = new Date().toISOString();
    await getStorage().updateTask(task);
    await recordAudit({ actionType: 'task.failed', taskId: task.taskId, actorRole: input.actorRole || 'user', outcome: 'failed', verificationStatus: 'not-verified', error: task.lastError, capabilityUsed: task.requiredCapability });
    return { ...task, progress: [...task.progress] };
  }
  await getStorage().updateTask(task);
  task.status = 'verifying';
  task.progress.push('Verifying internal execution evidence.');
  try {
    task.verificationResult = task.executionEvidence
      ? (input.verifyInternal ? await input.verifyInternal(task.executionEvidence) : 'Verified internal execution evidence is present.')
      : undefined;
  } catch (error) {
    task.verificationResult = undefined;
    task.lastError = error instanceof Error ? `Verification failed: ${error.message}` : 'Verification failed';
  }
  await getStorage().updateTask(task);
  if (!task.verificationResult) {
    task.status = 'failed';
    task.lastError ||= 'Execution completed without verifiable evidence';
    task.progress.push(`Failed: ${task.lastError}.`);
    task.updatedAt = new Date().toISOString();
    await getStorage().updateTask(task);
    await recordAudit({ actionType: 'task.failed', taskId: task.taskId, actorRole: input.actorRole || 'user', outcome: 'failed', verificationStatus: 'not-verified', error: task.lastError, capabilityUsed: task.requiredCapability });
    return { ...task, progress: [...task.progress] };
  }
  task.status = 'completed';
  task.verificationStatus = 'verified';
  task.finalResult = 'Task completed: no external side effect was requested.';
  task.progress.push(task.finalResult);
  task.lastSuccessfulStep = task.finalResult;
  task.updatedAt = new Date().toISOString();
  await getStorage().updateTask(task);
  await recordAudit({ actionType: 'task.completed', taskId: task.taskId, actorRole: input.actorRole || 'user', outcome: 'completed', verificationStatus: 'verified', capabilityUsed: task.requiredCapability, verificationResult: task.verificationResult, lifecycleTransitions: [
    { state: 'created', timestamp: task.createdAt },
    { state: 'classified', timestamp: task.updatedAt, evidence: task.requiredCapability },
    { state: 'planned', timestamp: task.updatedAt, evidence: task.executionPlan.validationRequirement },
    { state: 'executing', timestamp: task.updatedAt, evidence: task.executionEvidence },
    { state: 'verifying', timestamp: task.updatedAt, evidence: task.verificationResult },
    { state: 'completed', timestamp: task.updatedAt, evidence: task.finalResult },
  ] });
  return { ...task, progress: [...task.progress] };
}

export function getTask(taskId: string): Promise<TaskRecord | undefined> {
  return getStorage().getTask(taskId);
}

export function listTasks(): Promise<TaskRecord[]> {
  return getStorage().listTasks();
}

export function listTaskHistory(taskId: string) { return getStorage().listTaskHistory(taskId); }

export async function reloadTasks(): Promise<void> { await getStorage().initialize(); }
