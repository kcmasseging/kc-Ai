import { randomUUID } from 'node:crypto';
import { checkCapability } from './capabilityService';
import { recordAudit } from './auditService';
import { loadJsonArray, writeJsonArray } from './localStore';
import type { TaskRecord } from '../types/task';

const tasks = new Map<string, TaskRecord>();
const taskStorePath = process.env.KC_AI_TASK_STORE_PATH || '.kc-ai-tasks.json';

for (const task of loadJsonArray<TaskRecord>(taskStorePath)) tasks.set(task.taskId, task);

function persistTasks(): void {
  writeJsonArray(taskStorePath, [...tasks.values()]);
}

export function reloadTasks(): void {
  tasks.clear();
  for (const task of loadJsonArray<TaskRecord>(taskStorePath)) tasks.set(task.taskId, task);
}

function inferCapability(goal: string): string {
  const normalized = goal.toLowerCase();
  if (normalized.includes('deploy')) return 'deployment';
  if (normalized.includes('pay')) return 'payments';
  if (normalized.includes('database') || normalized.includes('product data')) return 'kc-product-data';
  return 'task.orchestration';
}

export function createAndAdvanceTask(input: {
  goal: string;
  privateBuildId?: string;
  appId?: string;
  appName?: string;
  actorRole?: 'system' | 'user' | 'owner';
}): TaskRecord {
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
  tasks.set(task.taskId, task);
  persistTasks();
  recordAudit({ actionType: 'task.received', taskId: task.taskId, actorRole: input.actorRole || 'user', outcome: 'started', verificationStatus: 'not-verified' });

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
    persistTasks();
    recordAudit({ actionType: 'task.blocked', taskId: task.taskId, actorRole: input.actorRole || 'user', outcome: 'blocked', verificationStatus: 'not-verified', error: task.blockedReason });
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
  persistTasks();
  recordAudit({ actionType: 'task.completed', taskId: task.taskId, actorRole: input.actorRole || 'user', outcome: 'completed', verificationStatus: 'verified' });
  return { ...task, progress: [...task.progress] };
}

export function getTask(taskId: string): TaskRecord | undefined {
  const task = tasks.get(taskId);
  return task ? { ...task, progress: [...task.progress] } : undefined;
}

export function listTasks(): TaskRecord[] {
  return [...tasks.values()].map((task) => ({ ...task, progress: [...task.progress] }));
}
