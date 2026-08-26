import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalStorage, configureStorage } from '../services/storage';
import { applyCorrection, createProjectIntent, loadProjectIntent, recordRejectedRequirement, recordUnresolvedQuestion, summarizeProjectIntent, toProjectSpecification, updateProjectIntent } from '../services/projectIntentService';

let directory: string;

function useStorage(): void {
  directory = mkdtempSync(path.join(tmpdir(), 'kc-ai-intent-'));
  configureStorage(new LocalStorage(path.join(directory, 'tasks.json'), path.join(directory, 'audit.json'), path.join(directory, 'history.json'), path.join(directory, 'wallets.json')));
}

afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

describe('persistent project intent foundation', () => {
  it('creates a project intent from the owner statement', async () => {
    useStorage();
    const intent = await createProjectIntent({ ownerId: 'owner-a', statement: 'I want to build KC Telecom.' });
    expect(intent.projectId).toMatch(/^project_/);
    expect(intent.ownerId).toBe('owner-a');
    expect(intent.projectName).toBe('KC Telecom');
    expect(intent.projectGoal).toBe('KC Telecom');
    expect(intent.version).toBe(1);
  });

  it('updates the same project with additional confirmed information', async () => {
    useStorage();
    const created = await createProjectIntent({ ownerId: 'owner-a', statement: 'I want to build KC Telecom.' });
    const updated = await updateProjectIntent({ projectId: created.projectId, ownerId: 'owner-a', statement: 'It should provide eSIM services.' });
    expect(updated.projectId).toBe(created.projectId);
    expect(updated.confirmedRequirements).toContain('provide eSIM services');
  });

  it('applies corrections without leaving the contradicted requirement active', async () => {
    useStorage();
    const created = await createProjectIntent({ ownerId: 'owner-a', statement: 'KC Telecom will only use eSIM.' });
    const corrected = await applyCorrection({ projectId: created.projectId, ownerId: 'owner-a', statement: "No, don't make it only eSIM. It should support physical SIM too." });
    expect(corrected.confirmedRequirements).not.toContain('only eSIM');
    expect(corrected.confirmedRequirements).toContain('physical SIM support');
    expect(corrected.corrections).toHaveLength(1);
  });

  it('keeps rejected requirements separate and inactive', async () => {
    useStorage();
    const created = await createProjectIntent({ ownerId: 'owner-a', statement: 'I want to build KC Telecom.' });
    const rejected = await recordRejectedRequirement({ projectId: created.projectId, ownerId: 'owner-a', requirement: 'cryptocurrency payments' });
    expect(rejected.rejectedRequirements).toContain('cryptocurrency payments');
    expect(rejected.confirmedRequirements).not.toContain('cryptocurrency payments');
  });

  it('keeps inferred requirements separate and preserves unresolved questions', async () => {
    useStorage();
    const created = await createProjectIntent({ ownerId: 'owner-a', statement: 'I want to build KC Telecom.' });
    const inferred = await updateProjectIntent({ projectId: created.projectId, ownerId: 'owner-a', statement: 'It will likely serve customers globally.' });
    const unresolved = await recordUnresolvedQuestion({ projectId: inferred.projectId, ownerId: inferred.ownerId, question: 'pay' });
    expect(inferred.inferredRequirements).toContain('It will likely serve customers globally.');
    expect(unresolved.confirmedRequirements).not.toContain('cards');
    expect(unresolved.unresolvedQuestions).toContain('Which payment methods should customers be able to use?');
  });

  it('isolates two projects and survives local persistence reload', async () => {
    useStorage();
    const telecom = await createProjectIntent({ ownerId: 'owner-a', statement: 'I want to build KC Telecom.' });
    const browser = await createProjectIntent({ ownerId: 'owner-a', statement: 'I want to build KC Browser.' });
    await updateProjectIntent({ projectId: telecom.projectId, ownerId: telecom.ownerId, statement: 'It should provide eSIM services.' });
    const reloaded = new LocalStorage(path.join(directory, 'tasks.json'), path.join(directory, 'audit.json'), path.join(directory, 'history.json'), path.join(directory, 'wallets.json'));
    configureStorage(reloaded);
    const loadedTelecom = await loadProjectIntent(telecom.projectId, 'owner-a');
    const loadedBrowser = await loadProjectIntent(browser.projectId, 'owner-a');
    expect(loadedTelecom?.confirmedRequirements).toContain('provide eSIM services');
    expect(loadedBrowser?.confirmedRequirements).not.toContain('provide eSIM services');
    expect(loadedBrowser?.projectName).toBe('KC Browser');
  });

  it('summarizes current state and produces a non-inventing future specification', async () => {
    useStorage();
    const intent = await createProjectIntent({ ownerId: 'owner-a', statement: 'I want to build KC Browser.' });
    const summary = summarizeProjectIntent(intent);
    const specification = toProjectSpecification(intent);
    expect(summary).toContain('Project: KC Browser');
    expect(summary).toContain('Confirmed requirements: none recorded');
    expect(specification).toMatchObject({ projectId: intent.projectId, projectName: 'KC Browser', confirmedRequirements: [], unresolvedQuestions: [] });
    expect(JSON.stringify(specification)).not.toContain('payments');
  });
});