import { describe, expect, it } from 'vitest';
import { checkCapability } from '../services/capabilityService';
import { clearAuditRecords, listAuditRecords } from '../services/auditService';
import { classifyGoal, createAndAdvanceTask } from '../services/taskService';

describe('KC AI decision and execution brain', () => {
  it.each([
    'Continue from the current main branch. Start building the real KC Browser capability now... Connect the existing Open KC Browser UI/button ... show useful research results...',
    'Build a message composer UI',
    'Improve KC Messaging status cards',
  ])('routes development goal internally: %s', (goal) => {
    expect(classifyGoal(goal)).toBe('task.orchestration');
    expect(classifyGoal(goal)).not.toBe('message.send');
    expect(classifyGoal(goal)).not.toBe('email.send');
  });

  it('requires send intent and an external destination for message.send', () => {
    expect(classifyGoal('Send a message to example@example.com saying hello')).toBe('message.send');
    expect(classifyGoal('Message this customer')).toBe('message.send');
    expect(classifyGoal('Update chat response formatting')).toBe('task.orchestration');
  });

  it('completes internal work only after execution and verification', async () => {
    await clearAuditRecords();
    const task = await createAndAdvanceTask({ goal: 'analyze the supplied internal notes' });

    expect(task.status).toBe('completed');
    expect(task.understanding?.externalSideEffect).toBe(false);
    expect(task.executionPlan).toMatchObject({ taskId: task.taskId, requiredCapability: 'task.orchestration' });
    expect(task.executionEvidence).toBeTruthy();
    expect(task.result).toContain('KC AI completed internal processing');
    expect(task.verificationResult).toBeTruthy();
    expect((await listAuditRecords()).find((record) => record.taskId === task.taskId && record.outcome === 'completed')?.lifecycleTransitions?.map((entry) => entry.state)).toEqual([
      'created', 'classified', 'planned', 'executing', 'verifying', 'completed',
    ]);
  });

  it.each([
    ['email.send', 'send an email to the test recipient'],
    ['payment.transfer', 'transfer a payment to the test account'],
    ['deployment.execute', 'deploy this build to production'],
  ])('blocks unsupported %s work', async (requiredCapability, goal) => {
    const task = await createAndAdvanceTask({ goal });

    expect(task.status).toBe('blocked');
    expect(task.requiredCapability).toBe(requiredCapability);
    expect(task.verificationStatus).toBe('not-verified');
    expect(task.executionEvidence).toBeUndefined();
    expect(task.blockedReason).toBeTruthy();
    expect(task.result).toContain(`Required capability: ${requiredCapability}`);
    expect(task.result).toContain(`Reason: ${task.blockedReason}`);
    expect(task.result).toContain('External action executed: no.');
    expect(task.result).toContain('Verification status: not-verified.');
  });

  it('does not allow a public request to activate an owner-only capability', async () => {
    const task = await createAndAdvanceTask({ goal: 'create a private build for staging', actorRole: 'user' });

    expect(task.requiredCapability).toBe('owner.private-build');
    expect(task.status).toBe('blocked');
    expect(task.blockedReason).toContain('Owner authorization');
  });

  it('isolates sequential task classification from the preceding email task', async () => {
    const emailTask = await createAndAdvanceTask({ goal: 'send an email to the test recipient' });
    const browserBuildTask = await createAndAdvanceTask({ goal: 'Build KC Browser' });

    expect(emailTask.requiredCapability).toBe('email.send');
    expect(browserBuildTask.requiredCapability).toBe('task.orchestration');
    expect(browserBuildTask.requiredCapability).not.toBe(emailTask.requiredCapability);
    expect(browserBuildTask.goal).toBe('Build KC Browser');
  });

  it('does not inherit a previous message.send classification during browser development', async () => {
    const messageTask = await createAndAdvanceTask({ goal: 'Send a message to example@example.com saying hello' });
    const browserBuildTask = await createAndAdvanceTask({ goal: 'Build KC Browser and show useful research results' });

    expect(messageTask.requiredCapability).toBe('message.send');
    expect(browserBuildTask.requiredCapability).toBe('task.orchestration');
    expect(browserBuildTask.requiredCapability).not.toBe(messageTask.requiredCapability);
  });

  it('does not report an unavailable capability as executed', async () => {
    const task = await createAndAdvanceTask({ goal: 'search the web for KC AI' });

    expect(checkCapability(task.requiredCapability as string).status).not.toBe('available');
    expect(task.status).toBe('blocked');
    expect(task.executionEvidence).toBeUndefined();
    expect(task.verificationStatus).toBe('not-verified');
    expect(task.result).toContain('External action executed: no.');
  });

  it('cannot complete when execution produces no verifiable evidence', async () => {
    const task = await createAndAdvanceTask({ goal: 'prepare an internal checklist', executeInternal: () => undefined });

    expect(task.status).toBe('failed');
    expect(task.verificationStatus).toBe('not-verified');
    expect(task.finalResult).toBeUndefined();
    expect(task.result).toBeUndefined();
    expect(task.lastError).toContain('verifiable evidence');
  });

  it('records lifecycle evidence without secret values', async () => {
    await clearAuditRecords();
    const secret = 'token=never-write-this';
    const task = await createAndAdvanceTask({ goal: `summarize internal notes ${secret}` });
    const records = await listAuditRecords();
    const serialized = JSON.stringify(records.filter((record) => record.taskId === task.taskId));

    expect(serialized).not.toContain('never-write-this');
    expect(records.find((record) => record.taskId === task.taskId && record.outcome === 'completed')?.capabilityUsed).toBe('task.orchestration');
  });
});
