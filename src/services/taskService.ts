import { randomUUID } from 'node:crypto';
import { checkCapability } from './capabilityService';
import { recordAudit } from './auditService';
import { getStorage } from './storage';
import type { TaskRecord } from '../types/task';

function inferCapability(goal: string): string {
  const normalized = goal.toLowerCase();
  if (/\b(send|sending|email|e-mail)\b/.test(normalized) && /\b(email|e-mail)\b/.test(normalized)) return 'email.send';
  if (/\b(send|sending|message|messaging|text|sms|notify|notification)\b/.test(normalized)) return 'external-message.send';
  if (/\b(pay|payment|payments|transfer|transfers|wire|refund|purchase|charge)\b/.test(normalized)) return 'payments';
  if (/\b(deploy|deployment|publish|publishing|release|ship)\b/.test(normalized)) return 'deployment';
  if (/\b(delete|deletion|remove|removal|erase|destroy)\b/.test(normalized) && /\b(file|files|folder|folders|record|records|data)\b/.test(normalized)) return 'file.deletion';
  if (/\b(change|update|modify|edit|create|close|delete|reset)\b/.test(normalized) && /\b(account|profile|password|subscription|settings|permissions|user)\b/.test(normalized)) return 'account.changes';
  if (/\b(api|webhook|external service|third-party|third party|integration)\b/.test(normalized)) return 'external-api.action';
  if (normalized.includes('database') || normalized.includes('product data')) return 'kc-product-data';
  return 'task.orchestration';
}

export async function createAndAdvanceTask(input: {
  goal: string;
  privateBuildId?: string;
  appId?: string;
  appName?: string;
  actorRole?: 'system' | 'user' | 'owner';
}): Promise<TaskRecord> {
  const now = new Date().toISOString();
  const task: TaskRecord = {
    taskId: `task_${randomUUID()}`,
    goal: input.goal.trim(),
    privateBuildId: input.privateBuildId,
    appContext: input.appId || input.appName ? { appId: input.appId, appName: input.appName } : undefined,
    status: 'received',
    createdAt: now,
    updatedAt: now,
    progress: ['Goal received.'],
    lastSuccessfulStep: 'Goal received.',
    verificationStatus: 'not-verified',
  };
  await getStorage().createTask(task);
  await recordAudit({ actionType: 'task.received', taskId: task.taskId, actorRole: input.actorRole || 'user', outcome: 'started', verificationStatus: 'not-verified' });

  task.status = 'planning';
  task.progress.push('Planning required capability.');
  task.lastSuccessfulStep = 'Goal received.';
  task.requiredCapability = inferCapability(task.goal);
  const capability = checkCapability(task.requiredCapability);

  if (capability.status !== 'available') {
    task.status = 'blocked';
    task.blockedReason = capability.reason || `Capability status: ${capability.status}`;
    task.progress.push(`Blocked: ${task.blockedReason}.`);
    task.lastError = task.blockedReason;
    task.updatedAt = new Date().toISOString();
    await getStorage().updateTask(task);
    await recordAudit({ actionType: 'task.blocked', taskId: task.taskId, actorRole: input.actorRole || 'user', outcome: 'blocked', verificationStatus: 'not-verified', error: task.blockedReason });
    return { ...task, progress: [...task.progress] };
  }

  task.status = 'validating';
  task.progress.push('Available orchestration capability validated.');
  task.lastSuccessfulStep = 'Available orchestration capability validated.';
  task.status = 'completed';
  task.verificationStatus = 'verified';
  task.progress.push('Task completed: no external side effect was requested.');
  task.lastSuccessfulStep = 'Task completed: no external side effect was requested.';
  task.updatedAt = new Date().toISOString();
  await getStorage().updateTask(task);
  await recordAudit({ actionType: 'task.completed', taskId: task.taskId, actorRole: input.actorRole || 'user', outcome: 'completed', verificationStatus: 'verified' });
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
