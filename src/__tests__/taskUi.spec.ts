import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(__filename);
const { isBlockedTaskResponse } = nodeRequire('../../public/task-ui.js') as { isBlockedTaskResponse: (body: unknown) => boolean };

describe('KC AI task frontend response handling', () => {
  it('keeps supported internal task responses on the normal success path', () => {
    expect(isBlockedTaskResponse({ task: { goal: 'summarize internal notes', status: 'completed' } })).toBe(false);
  });

  it('recognizes the backend blocked email task contract for Task History', () => {
    const response = {
      task: {
        taskId: 'task_email',
        goal: 'Send a test email to example@example.com',
        status: 'blocked',
        blockedReason: 'No email provider integration is implemented',
        lastError: 'No email provider integration is implemented',
        verificationStatus: 'not-verified',
      },
    };
    expect(isBlockedTaskResponse(response)).toBe(true);
    expect(response.task.goal).toContain('Send a test email');
    expect(response.task.blockedReason).toContain('No email provider integration');
  });

  it('does not turn generic server errors into blocked tasks', () => {
    expect(isBlockedTaskResponse({ error: 'Database unavailable' })).toBe(false);
    expect(isBlockedTaskResponse({ task: { goal: 'internal task', status: 'failed', lastError: 'Database unavailable' } })).toBe(false);
    expect(isBlockedTaskResponse({ task: { goal: 'incomplete blocked response', status: 'blocked' } })).toBe(false);
  });
});