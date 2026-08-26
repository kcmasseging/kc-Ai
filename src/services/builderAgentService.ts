import type { BuilderToolRequest, ToolResult } from './builderExecutionService';
import type { BuildRun, Project } from '../types/builderContracts';

export interface BuilderAgentContext { project: Project; buildRun: BuildRun; approvedHandoffId: string; }

export interface BuilderAgentProvider {
  readonly providerId: string;
  generate(input: { context: BuilderAgentContext; instruction: string }): Promise<{ toolRequests: unknown[]; message: string }>;
}

export interface BuilderAgent {
  readonly agentId: string;
  readonly provider: BuilderAgentProvider;
  plan(context: BuilderAgentContext, instruction: string): Promise<{ toolRequests: BuilderToolRequest[]; message: string }>;
  executeTool(context: BuilderAgentContext, request: unknown): Promise<ToolResult>;
}

export class ProviderIndependentBuilderAgent implements BuilderAgent {
  readonly agentId = 'kc-builder-agent';
  constructor(readonly provider: BuilderAgentProvider, private readonly execute: (project: Project, request: unknown) => Promise<ToolResult>) {}

  async plan(context: BuilderAgentContext, instruction: string): Promise<{ toolRequests: BuilderToolRequest[]; message: string }> {
    const response = await this.provider.generate({ context, instruction });
    return { toolRequests: response.toolRequests as BuilderToolRequest[], message: response.message };
  }

  executeTool(context: BuilderAgentContext, request: unknown): Promise<ToolResult> { return this.execute(context.project, request); }
}