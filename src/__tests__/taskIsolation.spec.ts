import { describe, expect, it } from 'vitest';
import { createAndAdvanceTask } from '../services/taskService';
import { reloadTasks } from '../services/taskService';
import { clearAuditRecords, listAuditRecords } from '../services/auditService';

const searchProvider = {
  name: 'test-search',
  isConfigured: () => true,
  search: async (query: string) => ({ provider: 'test-search', query, results: [{ title: 'KC Browser', url: 'https://example.com/kc-browser', domain: 'example.com', snippet: 'Read-only result', rank: 1 }] }),
};

describe('KC AI task isolation', () => {
  it('classifies a new internal task independently after blocked email work', async () => {
    const email = await createAndAdvanceTask({ goal: 'Send an email to the test recipient' });
    const internal = await createAndAdvanceTask({ goal: 'Analyze the internal task notes' });

    expect(email.requiredCapability).toBe('email.send');
    expect(email.status).toBe('blocked');
    expect(internal.requiredCapability).toBe('task.orchestration');
    expect(internal.status).toBe('completed');
    expect(internal.result).not.toContain('email.send');
    expect(internal.executionContext?.contextId).not.toBe(email.executionContext?.contextId);
  });

  it('does not carry email classification into a KC Browser architecture task', async () => {
    await createAndAdvanceTask({ goal: 'Send an email to the test recipient' });
    const browser = await createAndAdvanceTask({ goal: 'Build KC Browser as a read-only capability inside KC AI' });

    expect(browser.requiredCapability).not.toBe('email.send');
    expect(browser.requiredCapability).toBe('task.orchestration');
    expect(browser.status).toBe('completed');
  });

  it('classifies payment and web search tasks independently', async () => {
    const payment = await createAndAdvanceTask({ goal: 'Transfer payment to the test account' });
    const search = await createAndAdvanceTask({ goal: 'Search the web for KC Browser architecture', searchProvider });

    expect(payment.requiredCapability).toBe('payment.transfer');
    expect(payment.status).toBe('blocked');
    expect(search.requiredCapability).toBe('web.search');
    expect(['completed', 'blocked']).toContain(search.status);
    if (search.status === 'completed') expect(search.webSearch?.query).toContain('KC Browser architecture');
  });

  it('keeps simultaneous task contexts and results separate', async () => {
    const [first, second] = await Promise.all([
      createAndAdvanceTask({ goal: 'Analyze the first internal task', executeInternal: async () => 'first result' }),
      createAndAdvanceTask({ goal: 'Analyze the second internal task', executeInternal: async () => 'second result' }),
    ]);

    expect(first.taskId).not.toBe(second.taskId);
    expect(first.executionContext?.contextId).not.toBe(second.executionContext?.contextId);
    expect(first.result).toBe('first result');
    expect(second.result).toBe('second result');
  });

  it('uses prior context only when an explicit continuation is requested', async () => {
    const previous = await createAndAdvanceTask({ goal: 'Send an email to the test recipient' });
    const unrelated = await createAndAdvanceTask({ goal: 'Retry an internal checklist', continuationTaskId: previous.taskId });
    const followUp = await createAndAdvanceTask({ goal: 'Retry the previous email task', continuationTaskId: previous.taskId });

    expect(unrelated.executionContext?.priorContextUsed).toBe(false);
    expect(unrelated.executionContext?.explicitTaskReference).toBeUndefined();
    expect(followUp.executionContext?.priorContextUsed).toBe(true);
    expect(followUp.executionContext?.explicitTaskReference).toBe(previous.taskId);
    expect(followUp.requiredCapability).toBe('email.send');
  });

  it('does not reuse classification after task storage reload', async () => {
    await createAndAdvanceTask({ goal: 'Send an email to the test recipient' });
    await reloadTasks();
    const fresh = await createAndAdvanceTask({ goal: 'Build KC Browser as a read-only capability' });

    expect(fresh.requiredCapability).toBe('task.orchestration');
    expect(fresh.status).toBe('completed');
  });

  it('records non-secret classification evidence for each isolated task', async () => {
    await clearAuditRecords();
    const task = await createAndAdvanceTask({ goal: 'Analyze the current service status' });
    const audits = await listAuditRecords();
    const classified = audits.find((record) => record.actionType === 'task.classified' && record.taskId === task.taskId);

    expect(classified).toMatchObject({ taskId: task.taskId, classification: 'task.orchestration', priorContextUsed: false });
    expect(classified?.goalHash).toMatch(/^[a-f0-9]{64}$/);
    expect(classified?.classificationTimestamp).toBe(task.executionContext?.classificationTimestamp);
  });
});