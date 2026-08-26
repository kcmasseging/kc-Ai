import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { redactSensitive } from './auditService';
import type { ActivityLogItem, BuildRun, BuildRunStatus, Project } from '../types/builderContracts';

const FilePath = z.string().min(1).max(1000).refine((value) => !path.isAbsolute(value) && !value.includes('\0') && !value.split(/[\\/]+/).includes('..'), 'Path must be relative and remain inside the project workspace');
const FileRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('file.read'), path: FilePath }),
  z.object({ type: z.literal('file.create'), path: FilePath, content: z.string().max(1_000_000) }),
  z.object({ type: z.literal('file.edit'), path: FilePath, expectedContent: z.string().max(1_000_000), replacement: z.string().max(1_000_000) }),
]);
const ToolRequestSchema = z.union([
  z.object({ type: z.literal('file.read'), path: FilePath }),
  z.object({ type: z.literal('file.create'), path: FilePath, content: z.string().max(1_000_000) }),
  z.object({ type: z.literal('file.edit'), path: FilePath, expectedContent: z.string().max(1_000_000), replacement: z.string().max(1_000_000) }),
  z.object({ type: z.literal('command.execute'), command: z.string().min(1).max(2000), approved: z.boolean() }),
]);
export type BuilderToolRequest = z.infer<typeof ToolRequestSchema>;

export interface ToolResult { ok: boolean; type: BuilderToolRequest['type']; path?: string; content?: string; error?: string; capability: 'available' | 'unavailable'; }

export class BuilderExecutionError extends Error {}

function workspaceKey(projectId: string): string { return createHash('sha256').update(projectId).digest('hex').slice(0, 32); }
function safeDetail(detail?: string): string | undefined { return redactSensitive(detail); }

export class ProjectWorkspaceService {
  constructor(private readonly baseRoot = path.resolve(process.env.KC_BUILDER_WORKSPACE_ROOT || '.kc-builder-workspaces')) {}

  async createProject(project: { projectId: string; name: string; now?: string }): Promise<Project> {
    const now = project.now || new Date().toISOString();
    const workspacePath = path.join(this.baseRoot, workspaceKey(project.projectId));
    await fs.mkdir(workspacePath, { recursive: true, mode: 0o700 });
    return { projectId: project.projectId, name: project.name.trim(), workspacePath, createdAt: now, updatedAt: now };
  }

  async root(project: Project): Promise<string> {
    await fs.mkdir(project.workspacePath, { recursive: true, mode: 0o700 });
    return project.workspacePath;
  }

  async resolve(project: Project, relativePath: string, allowMissing = false): Promise<string> {
    const root = path.resolve(await this.root(project));
    const candidate = path.resolve(root, relativePath);
    if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) throw new BuilderExecutionError('Path escapes the project workspace');
    let existing = allowMissing ? path.dirname(candidate) : candidate;
    let realExisting: string;
    while (true) {
      try { realExisting = await fs.realpath(existing); break; } catch {
        const parent = path.dirname(existing);
        if (parent === existing) throw new BuilderExecutionError('Workspace path does not exist');
        existing = parent;
      }
    }
    if (realExisting !== root && !realExisting.startsWith(`${root}${path.sep}`)) throw new BuilderExecutionError('Symlinked path escapes the project workspace');
    return candidate;
  }
}

export class BuilderToolService {
  constructor(private readonly workspaces: ProjectWorkspaceService) {}

  async execute(project: Project, rawRequest: unknown, log: (item: ActivityLogItem) => Promise<void> = async () => {}): Promise<ToolResult> {
    const parsed = ToolRequestSchema.safeParse(rawRequest);
    if (!parsed.success) return { ok: false, type: 'file.read', error: 'Invalid structured tool request', capability: 'unavailable' };
    const request = parsed.data;
    if (request.type === 'command.execute') {
      const error = request.approved ? 'Approved command execution is unavailable in this environment' : 'Command execution requires explicit approval';
      await log({ activityId: `activity_${randomUUID()}`, projectId: project.projectId, action: 'command.execute', outcome: 'blocked', detail: safeDetail(error), createdAt: new Date().toISOString() });
      return { ok: false, type: request.type, error, capability: 'unavailable' };
    }
    try {
      const target = await this.workspaces.resolve(project, request.path, request.type === 'file.create');
      if (request.type === 'file.read') {
        const content = await fs.readFile(target, 'utf8');
        await log({ activityId: `activity_${randomUUID()}`, projectId: project.projectId, action: request.type, outcome: 'completed', detail: `Read ${request.path}`, createdAt: new Date().toISOString() });
        return { ok: true, type: request.type, path: request.path, content, capability: 'available' };
      }
      if (request.type === 'file.create') {
        await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        await fs.writeFile(target, request.content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        await log({ activityId: `activity_${randomUUID()}`, projectId: project.projectId, action: request.type, outcome: 'completed', detail: `Created ${request.path}`, createdAt: new Date().toISOString() });
        return { ok: true, type: request.type, path: request.path, capability: 'available' };
      }
      const current = await fs.readFile(target, 'utf8');
      if (current !== request.expectedContent) return { ok: false, type: request.type, path: request.path, error: 'Edit precondition did not match current file content', capability: 'available' };
      await fs.writeFile(target, request.replacement, 'utf8');
      await log({ activityId: `activity_${randomUUID()}`, projectId: project.projectId, action: request.type, outcome: 'completed', detail: `Edited ${request.path}`, createdAt: new Date().toISOString() });
      return { ok: true, type: request.type, path: request.path, capability: 'available' };
    } catch (error) {
      const detail = safeDetail(error instanceof Error ? error.message : 'File operation failed');
      await log({ activityId: `activity_${randomUUID()}`, projectId: project.projectId, action: request.type, outcome: 'failed', detail, createdAt: new Date().toISOString() });
      return { ok: false, type: request.type, path: request.path, error: detail, capability: 'available' };
    }
  }
}

const transitions: Record<BuildRunStatus, BuildRunStatus[]> = {
  QUEUED: ['UNDERSTANDING', 'BLOCKED'], UNDERSTANDING: ['BUILDING', 'WAIT', 'BLOCKED'], BUILDING: ['TESTING', 'WAIT', 'FAILED', 'BLOCKED'], TESTING: ['FIXING', 'COMPLETED', 'FAILED', 'BLOCKED'], FIXING: ['BUILDING', 'TESTING', 'FAILED', 'BLOCKED'], WAIT: ['UNDERSTANDING', 'BUILDING', 'BLOCKED'], COMPLETED: [], FAILED: [], BLOCKED: [],
};

export function transitionBuildRun(run: BuildRun, target: BuildRunStatus, now = new Date().toISOString()): BuildRun {
  if (!transitions[run.status].includes(target)) throw new BuilderExecutionError(`Invalid BuildRun transition from ${run.status} to ${target}`);
  return { ...run, status: target, updatedAt: now };
}

export function createBuildRun(input: { projectId: string; handoffId: string; specificationVersion: number; now?: string }): BuildRun {
  const now = input.now || new Date().toISOString();
  return { buildRunId: `run_${randomUUID()}`, projectId: input.projectId, handoffId: input.handoffId, specificationVersion: input.specificationVersion, status: 'QUEUED', createdAt: now, updatedAt: now };
}