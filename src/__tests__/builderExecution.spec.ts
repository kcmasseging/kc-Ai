import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BuilderExecutionError, BuilderToolService, ProjectWorkspaceService, createBuildRun, transitionBuildRun } from '../services/builderExecutionService';
import { ProviderIndependentBuilderAgent } from '../services/builderAgentService';
import type { Project } from '../types/builderContracts';

let directory: string;
let project: Project;
let tools: BuilderToolService;

async function setup(): Promise<void> {
  directory = mkdtempSync(path.join(tmpdir(), 'kc-builder-'));
  const workspaces = new ProjectWorkspaceService(path.join(directory, 'workspaces'));
  project = await workspaces.createProject({ projectId: 'project-a', name: 'Example' });
  tools = new BuilderToolService(workspaces);
}

afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe('Builder execution foundation', () => {
  it('creates, reads, and edits files inside an isolated project workspace', async () => {
    await setup();
    expect((await tools.execute(project, { type: 'file.create', path: 'src/index.ts', content: 'export const value = 1;' })).ok).toBe(true);
    expect((await tools.execute(project, { type: 'file.read', path: 'src/index.ts' })).content).toContain('value = 1');
    expect((await tools.execute(project, { type: 'file.edit', path: 'src/index.ts', expectedContent: 'export const value = 1;', replacement: 'export const value = 2;' })).ok).toBe(true);
  });

  it.each(['../outside.txt', '/tmp/outside.txt', 'src/../../outside.txt'])('rejects traversal path %s', async (filePath) => {
    await setup();
    const result = await tools.execute(project, { type: 'file.create', path: filePath, content: 'must not write' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Invalid structured tool request');
  });

  it('rejects symlink escapes and never follows them outside the project root', async () => {
    await setup();
    const outside = path.join(directory, 'outside');
    const workspace = path.dirname(project.workspacePath);
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(outside);
    await mkdir(workspace, { recursive: true });
    await writeFile(path.join(outside, 'secret.txt'), 'private');
    symlinkSync(outside, path.join(project.workspacePath, 'linked'));
    const result = await tools.execute(project, { type: 'file.read', path: 'linked/secret.txt' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Symlinked path escapes');
  });

  it('uses edit preconditions and does not overwrite changed content', async () => {
    await setup();
    await tools.execute(project, { type: 'file.create', path: 'notes.txt', content: 'current' });
    const result = await tools.execute(project, { type: 'file.edit', path: 'notes.txt', expectedContent: 'stale', replacement: 'new' });
    expect(result.error).toContain('precondition');
    expect((await tools.execute(project, { type: 'file.read', path: 'notes.txt' })).content).toBe('current');
  });

  it('keeps command execution unavailable even when a request is marked approved', async () => {
    await setup();
    const logs: string[] = [];
    const result = await tools.execute(project, { type: 'command.execute', command: 'echo secret=do-not-log', approved: true }, async (item) => { logs.push(item.detail || ''); });
    expect(result.capability).toBe('unavailable');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('unavailable');
    expect(logs.join(' ')).not.toContain('do-not-log');
  });

  it('validates BuildRun transitions and keeps the agent provider-independent', async () => {
    await setup();
    const run = createBuildRun({ projectId: project.projectId, handoffId: 'handoff-1', specificationVersion: 1, now: '2026-01-01T00:00:00.000Z' });
    expect(transitionBuildRun(run, 'UNDERSTANDING').status).toBe('UNDERSTANDING');
    expect(() => transitionBuildRun(run, 'COMPLETED')).toThrow(BuilderExecutionError);
    const provider = { providerId: 'test-provider', generate: async () => ({ toolRequests: [], message: 'planned' }) };
    const agent = new ProviderIndependentBuilderAgent(provider, (currentProject, request) => tools.execute(currentProject, request));
    expect((await agent.plan({ project, buildRun: run, approvedHandoffId: 'handoff-1' }, 'inspect')).message).toBe('planned');
    expect(agent.provider.providerId).toBe('test-provider');
  });
});