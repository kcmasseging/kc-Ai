import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { configureStorage, LocalStorage } from '../services/storage';
import { recallOwnerMemory, understandOwnerMessage, projectReadiness } from '../services/conversationUnderstandingService';

let directory: string;
function useStorage(): void {
  directory = mkdtempSync(path.join(tmpdir(), 'kc-ai-conversation-'));
  configureStorage(new LocalStorage(...['tasks', 'audit', 'history', 'wallets', 'intents', 'conversations'].map((name) => path.join(directory, `${name}.json`)) as [string, string, string, string, string, string]));
}
async function say(ownerId: string, sessionId: string, message: string) { return understandOwnerMessage({ ownerId, sessionId, message }); }
afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe('conversation project understanding', () => {
  it('keeps additions in the same project across turns', async () => {
    useStorage();
    const first = await say('owner-a', 'session-a', 'I want to build KC Telecom.');
    const second = await say('owner-a', 'session-a', 'It should sell airtime.');
    const third = await say('owner-a', 'session-a', 'It should sell data.');
    expect(second.activeProjectId).toBe(first.activeProjectId);
    expect(third.intent?.confirmedRequirements).toEqual(expect.arrayContaining(['sell airtime', 'sell data']));
  });

  it('applies a natural eSIM correction and keeps physical SIM', async () => {
    useStorage();
    const first = await say('owner-a', 'session-a', 'I want to build KC Telecom.');
    await say('owner-a', 'session-a', 'It should support eSIM.');
    const corrected = await say('owner-a', 'session-a', 'No, not eSIM only. Add physical SIM.');
    expect(corrected.activeProjectId).toBe(first.activeProjectId);
    expect(corrected.intent?.confirmedRequirements).toEqual(expect.arrayContaining(['physical SIM support']));
    expect(corrected.intent?.confirmedRequirements).not.toContain('only eSIM');
  });

  it('keeps rejection and questions out of confirmed requirements until approval', async () => {
    useStorage();
    await say('owner-a', 'session-a', 'I want to build KC Telecom.');
    const rejected = await say('owner-a', 'session-a', "I don't want cryptocurrency payments.");
    expect(rejected.intent?.rejectedRequirements).toContain('cryptocurrency payments');
    const question = await say('owner-a', 'session-a', 'Can it support crypto payments?');
    expect(question.intent?.confirmedRequirements).not.toContain('crypto payments');
    const approved = await say('owner-a', 'session-a', 'Yes, add it.');
    expect(approved.intent?.confirmedRequirements).toContain('crypto payments');
  });

  it('asks before removing an ambiguous target', async () => {
    useStorage();
    await say('owner-a', 'session-a', 'I want to build KC Telecom.');
    await say('owner-a', 'session-a', 'It should support accounts.');
    await say('owner-a', 'session-a', 'It should support payments.');
    const result = await say('owner-a', 'session-a', 'Remove that.');
    expect(result.interpretation.confidence).toBe('AMBIGUOUS');
    expect(result.reply).toContain('Which requirement');
  });

  it('switches and restores projects without leaking requirements', async () => {
    useStorage();
    const telecom = await say('owner-a', 'session-a', 'I want to build KC Telecom.');
    await say('owner-a', 'session-a', 'It should sell airtime.');
    const browser = await say('owner-a', 'session-a', "Let's discuss KC Browser.");
    await say('owner-a', 'session-a', 'It should research safely.');
    const restored = await say('owner-a', 'session-a', 'Go back to KC Telecom.');
    expect(restored.activeProjectId).toBe(telecom.activeProjectId);
    expect(restored.intent?.confirmedRequirements).toContain('sell airtime');
    expect(restored.intent?.confirmedRequirements).not.toContain('research safely');
    expect(browser.activeProjectId).not.toBe(telecom.activeProjectId);
  });

  it('persists context and isolates owners', async () => {
    useStorage();
    const created = await say('owner-a', 'session-a', 'I want to build KC Telecom.');
    await say('owner-a', 'session-a', 'It should sell data.');
    const reloaded = new LocalStorage(...['tasks', 'audit', 'history', 'wallets', 'intents', 'conversations'].map((name) => path.join(directory, `${name}.json`)) as [string, string, string, string, string, string]);
    configureStorage(reloaded);
    const continued = await say('owner-a', 'session-a', 'It should sell airtime.');
    const other = await say('owner-b', 'session-a', 'It should sell crypto.');
    expect(continued.activeProjectId).toBe(created.activeProjectId);
    expect(other.reply).toContain('Which project');
  });

  it('reports deterministic readiness without inventing unresolved items', async () => {
    useStorage();
    const project = await say('owner-a', 'session-a', 'I want to build KC Telecom.');
    expect(project.intent && projectReadiness(project.intent)).toBe('NEEDS_CLARIFICATION');
  });

  it('recalls stored owner decisions after a persistence reload', async () => {
    useStorage();
    const created = await say('owner-a', 'session-a', 'I want to build KC Telecom.');
    await say('owner-a', 'session-a', 'It should support physical SIM.');
    const reloaded = new LocalStorage(...['tasks', 'audit', 'history', 'wallets', 'intents', 'conversations'].map((name) => path.join(directory, `${name}.json`)) as [string, string, string, string, string, string]);
    configureStorage(reloaded);
    const matches = await recallOwnerMemory({ ownerId: 'owner-a', query: 'What was the decision about physical SIM?', projectId: created.activeProjectId });
    expect(matches[0]).toMatchObject({ content: expect.stringContaining('It should support physical SIM'), projectId: created.activeProjectId, role: 'owner' });
    const vague = await recallOwnerMemory({ ownerId: 'owner-a', query: 'What did we decide about this before?', projectId: created.activeProjectId });
    expect(vague[0]?.content).toContain('physical SIM');
  });

  it('returns no fabricated memory and keeps owners and projects isolated', async () => {
    useStorage();
    const telecom = await say('owner-a', 'session-a', 'I want to build KC Telecom.');
    await say('owner-a', 'session-a', 'It should support airtime.');
    const browser = await say('owner-a', 'session-a', "Let's discuss KC Browser.");
    await say('owner-a', 'session-a', 'It should support tabs.');
    expect(await recallOwnerMemory({ ownerId: 'owner-a', query: 'airtime', projectId: browser.activeProjectId })).toHaveLength(0);
    expect(await recallOwnerMemory({ ownerId: 'owner-b', query: 'airtime' })).toHaveLength(0);
    const missing = await say('owner-a', 'session-a', 'What did we decide about payments?');
    expect(missing.reply).toContain('could not find a saved conversation');
    expect(missing.reply).not.toContain('payments are supported');
    expect(telecom.activeProjectId).not.toBe(browser.activeProjectId);
  });
});