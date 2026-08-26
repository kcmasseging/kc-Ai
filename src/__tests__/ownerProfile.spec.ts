import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { configureStorage, LocalStorage } from '../services/storage';
import { loadOwnerProfile, updateOwnerProfile } from '../services/ownerProfileService';
import { createAndAdvanceTask } from '../services/taskService';
import app from '../index';

let directory: string;
function useStorage(): void {
  directory = mkdtempSync(path.join(tmpdir(), 'kc-robot-profile-'));
  configureStorage(new LocalStorage(...['tasks', 'audit', 'history', 'wallets', 'intents', 'conversations', 'profiles'].map((name) => path.join(directory, `${name}.json`)) as [string, string, string, string, string, string, string]));
}
afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe('KC Robot owner working profile and task intake foundation', () => {
  it('creates, updates, reloads, and isolates the persistent owner profile', async () => {
    useStorage();
    const saved = await updateOwnerProfile({ ownerId: 'owner-a', displayName: 'Kelvin', preferences: { responseStyle: 'concise' }, workingContext: ['KC Robot'], authorizationNotes: ['Routine reversible development is authorized'] });
    expect(saved.displayName).toBe('Kelvin');
    const reloaded = new LocalStorage(...['tasks', 'audit', 'history', 'wallets', 'intents', 'conversations', 'profiles'].map((name) => path.join(directory, `${name}.json`)) as [string, string, string, string, string, string, string]);
    configureStorage(reloaded);
    expect(await loadOwnerProfile('owner-a')).toMatchObject({ displayName: 'Kelvin', preferences: { responseStyle: 'concise' } });
    expect((await loadOwnerProfile('owner-b')).displayName).toBeUndefined();
  });

  it('starts internal work immediately and blocks risky external work truthfully', async () => {
    useStorage();
    const internal = await createAndAdvanceTask({ goal: 'prepare a KC Robot working checklist', actorRole: 'owner' });
    expect(internal.status).toBe('completed');
    expect(internal.verificationStatus).toBe('verified');
    expect(internal.progress.join(' ')).toContain('Execution plan created');
    const deployment = await createAndAdvanceTask({ goal: 'deploy KC Robot to production', actorRole: 'owner' });
    expect(deployment.status).toBe('blocked');
    expect(deployment.result).toContain('External action executed: no.');
    expect(deployment.verificationStatus).toBe('not-verified');
  });

  it('loads the owner profile into task planning and never completes without validation', async () => {
    useStorage();
    const profile = await updateOwnerProfile({ ownerId: 'owner-a', preferences: { preferredWorkingMethod: 'small reversible steps', outputStyle: 'checklist', autonomy: 'routine-only' }, workingContext: ['KC Robot'] });
    const task = await createAndAdvanceTask({ goal: 'prepare a private checklist', actorRole: 'owner', ownerProfile: profile, executeInternal: () => 'unvalidated result', verifyInternal: () => undefined });
    expect(task.executionPlan?.ownerProfileApplied).toMatchObject({ preferredWorkingMethod: 'small reversible steps', outputStyle: 'checklist', autonomy: 'routine-only', workingContext: ['KC Robot'] });
    expect(task.progress.join(' ')).toContain('Owner profile applied');
    expect(task.status).toBe('failed');
    expect(task.verificationStatus).toBe('not-verified');
  });

  it('denies task intake without verified Owner Mode', async () => {
    useStorage();
    const server = app.listen(0);
    try {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/owner/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal: 'prepare a checklist' }) });
      expect(response.status).toBe(401);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});