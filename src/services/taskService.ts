import { randomUUID } from 'node:crypto';
import { checkCapability, listCapabilities } from './capabilityService';
import { recordAudit } from './auditService';
import { getStorage } from './storage';
import { createHealthResponse } from './healthService';
import type { TaskRecord } from '../types/task';
import { WebSearchProviderError, type SearchProvider, type WebSearchResponse } from './webSearchService';
import { redactSensitive } from './auditService';
import { researchWeb } from './browserResearchService';
import { fetchWebPage, WebFetchError } from './webFetchService';

function inferCapability(goal: string): string {
  const normalized = goal.toLowerCase();
  if (/\b(fetch|read|open|retrieve)\b/.test(normalized) && /https?:\/\/\S+/.test(normalized)) return 'web.fetch/read';
  if (/\b(send|sending|email|e-mail)\b/.test(normalized) && /\b(email|e-mail)\b/.test(normalized)) return 'email.send';
  if (/\b(send|sending|message|messaging|text|sms|notify|notification)\b/.test(normalized)) return 'message.send';
  if (/\b(pay|payment|payments|transfer|transfers|wire|refund|purchase|charge)\b/.test(normalized)) return 'payment.transfer';
  if (/\b(deploy|deployment|publish|publishing|release|ship)\b/.test(normalized)) return 'deployment.execute';
  if (/\b(delete|deletion|remove|removal|erase|destroy)\b/.test(normalized) && /\b(file|files|folder|folders|record|records|data)\b/.test(normalized)) return 'file.delete';
  if (/\b(search|browse|look up|lookup)\b/.test(normalized) && /\b(web|internet|online)\b/.test(normalized)) return 'web.search';
  if (/\b(private build|private development|staging build)\b/.test(normalized)) return 'owner.private-build';
  if (/\b(change|update|modify|edit|create|close|delete|reset)\b/.test(normalized) && /\b(account|profile|password|subscription|settings|permissions|user)\b/.test(normalized)) return 'account.changes';
  if (/\b(api|webhook|external service|third-party|third party|integration)\b/.test(normalized)) return 'external-api.action';
  if (normalized.includes('database') || normalized.includes('product data')) return 'kc-product-data';
  return 'task.orchestration';
}

function understand(goal: string, capability: string): TaskRecord['understanding'] {
  const targetMatch = goal.match(/\b(?:to|for|in)\s+([^,.]+?)(?:\s+(?:saying|with|using)\b|[,\.]|$)/i);
  return {
    requestedAction: capability === 'task.orchestration' ? 'Analyze and organize the supplied task' : `Perform the requested ${capability} action`,
    target: targetMatch?.[1]?.trim(),
    parameters: { goal },
    externalSideEffect: capability !== 'task.orchestration' && !capability.startsWith('internal.'),
  };
}

function generateInternalResult(goal: string): string {
  const normalized = goal.toLowerCase();
  if (/(service|system|kc ai).*(status|health|working)|status.*(service|system|kc ai)/.test(normalized)) {
    const health = createHealthResponse(process.env.NODE_ENV || 'development');
    const capabilities = listCapabilities();
    const available = capabilities.filter((capability) => capability.status === 'available').map((capability) => capability.id);
    const unavailable = capabilities.filter((capability) => capability.status !== 'available').map((capability) => `${capability.id} (${capability.status})`);
    return `KC AI service status: ${health.status} (${health.service} ${health.version}, ${health.environment}). Available capabilities: ${available.join(', ')}. Unavailable or unimplemented capabilities: ${unavailable.join(', ')}.`;
  }
  return `KC AI completed internal processing for the supplied goal. No connected product data or external system evidence was supplied, so this result makes no claims beyond that internal processing occurred.`;
}

function generateBlockedResult(capability: string, reason: string): string {
  const enablement = capability === 'email.send'
    ? 'A verified email provider integration plus required credentials/configuration must be added before email sending can be enabled.'
    : `The ${capability} capability must be made available and any required integration, credentials, configuration, or authorization must be provided.`;
  const integration = capability === 'email.send'
    ? 'No email provider integration is implemented.'
    : 'No external action was executed.';
  return `BLOCKED\nRequired capability: ${capability}\nReason: ${reason}\n${integration}\nExternal action executed: no.\nRequired to enable: ${enablement}\nVerification status: not-verified.`;
}

function searchQuery(goal: string): string {
  return goal.replace(/^\s*(please\s+)?(search|look\s+up|browse)\s+(the\s+)?(web|internet|online)\s+(for|about)\s+/i, '').trim() || goal.trim();
}

function formatSearchResult(response: WebSearchResponse, timestamp: string): { text: string; summary: string } {
  const summary = response.results.length === 0
    ? 'The provider returned zero results for this query.'
    : response.results.slice(0, 3).map((result) => `${result.title}: ${result.snippet}`).join(' ');
  const results = response.results.length === 0
    ? 'No results returned.'
    : response.results.map((result) => `${result.rank}. ${result.title} [${result.domain}]\nURL: ${result.url}\n${result.snippet}`).join('\n');
  return {
    summary,
    text: `QUERY\n${redactSensitive(response.query)}\n\nRESULTS\n${redactSensitive(results)}\n\nSUMMARY\n${redactSensitive(summary)}\n\nVERIFICATION\nProvider ${response.provider} returned ${response.results.length} normalized result(s) at ${timestamp}.\n\nFINAL STATUS\ncompleted`,
  };
}

export async function createAndAdvanceTask(input: {
  goal: string;
  privateBuildId?: string;
  appId?: string;
  appName?: string;
  actorRole?: 'system' | 'user' | 'owner';
  executeInternal?: () => Promise<string | undefined> | string | undefined;
  verifyInternal?: (evidence: string) => Promise<string | undefined> | string | undefined;
  searchProvider?: SearchProvider;
  fetchPage?: (url: string) => ReturnType<typeof fetchWebPage>;
}): Promise<TaskRecord> {
  const now = new Date().toISOString();
  const task: TaskRecord = {
    taskId: `task_${randomUUID()}`,
    goal: input.goal.trim(),
    privateBuildId: input.privateBuildId,
    appContext: input.appId || input.appName ? { appId: input.appId, appName: input.appName } : undefined,
    status: 'created',
    createdAt: now,
    updatedAt: now,
    progress: ['Task created.'],
    verificationStatus: 'not-verified',
  };
  await getStorage().createTask(task);
  await recordAudit({ actionType: 'task.received', taskId: task.taskId, actorRole: input.actorRole || 'user', outcome: 'started', verificationStatus: 'not-verified' });

  task.requiredCapability = inferCapability(task.goal);
  task.understanding = understand(task.goal, task.requiredCapability);
  task.status = 'classified';
  task.progress.push(`Classified as ${task.requiredCapability}.`);
  await getStorage().updateTask(task);
  task.status = 'planned';
  task.progress.push('Execution plan created.');
  task.executionPlan = {
    taskId: task.taskId,
    requiredCapability: task.requiredCapability,
    intendedAction: task.understanding?.requestedAction || 'Perform the classified task',
    expectedResult: task.requiredCapability === 'task.orchestration' ? 'A structured internal task result' : 'The requested external side effect',
    validationRequirement: 'A real execution result must be available before completion',
  };
  await getStorage().updateTask(task);
  const capability = checkCapability(task.requiredCapability);

  if (capability.status !== 'available' || (capability.requiresOwner && input.actorRole !== 'owner')) {
    task.status = 'blocked';
    task.blockedReason = capability.requiresOwner && input.actorRole !== 'owner'
      ? 'Owner authorization is required for this capability'
      : capability.reason || `Capability status: ${capability.status}`;
    task.result = generateBlockedResult(task.requiredCapability, task.blockedReason);
    task.progress.push(`Blocked: ${task.blockedReason}.`);
    task.lastError = task.blockedReason;
    task.updatedAt = new Date().toISOString();
    await getStorage().updateTask(task);
    await recordAudit({ actionType: 'task.blocked', taskId: task.taskId, actorRole: input.actorRole || 'user', outcome: 'blocked', verificationStatus: 'not-verified', error: task.blockedReason, capabilityUsed: task.requiredCapability, lifecycleTransitions: ['created', 'classified', 'planned', 'blocked'].map((state) => ({ state, timestamp: task.updatedAt, evidence: state === 'blocked' ? task.blockedReason : task.requiredCapability })) });
    return { ...task, progress: [...task.progress] };
  }

  if (task.requiredCapability !== 'task.orchestration') {
    if (task.requiredCapability === 'web.fetch/read') {
      const pageUrl = task.goal.match(/https?:\/\/\S+/i)?.[0];
      task.status = 'executing';
      task.progress.push('Read-only web page retrieval started.');
      try {
        const page = await (input.fetchPage || fetchWebPage)(pageUrl!);
        task.result = `RETRIEVED SOURCE\nURL: ${page.url}\nRetrieved at: ${page.retrievedAt}\nContent type: ${page.contentType}\nUNTRUSTED PAGE CONTENT\n${page.content}`;
        task.sources = [{ title: page.url, url: page.url, domain: new URL(page.url).hostname, snippet: page.content.slice(0, 500), provider: 'web.fetch/read', retrievedAt: page.retrievedAt }];
        task.executionEvidence = `Retrieved ${page.contentType} content from ${page.url}; content is marked untrusted.`;
        task.verificationResult = `Verified retrieval response from web.fetch/read at ${page.retrievedAt}; no webpage instructions were executed.`;
        task.status = 'completed';
        task.verificationStatus = 'verified';
        task.finalResult = task.result;
        task.progress.push(task.finalResult);
        task.lastSuccessfulStep = task.finalResult;
        task.updatedAt = page.retrievedAt;
        await getStorage().updateTask(task);
        await recordAudit({ actionType: 'task.completed', taskId: task.taskId, actorRole: input.actorRole || 'user', outcome: 'completed', verificationStatus: 'verified', capabilityUsed: 'web.fetch/read', providerName: 'web-fetch', resultCount: 1, verificationResult: task.verificationResult });
        return { ...task, progress: [...task.progress] };
      } catch (error) {
        task.status = 'failed';
        task.lastError = error instanceof WebFetchError ? error.message : error instanceof Error ? error.message : 'Page retrieval failed unexpectedly';
        task.progress.push(`Failed: ${task.lastError}.`);
        task.updatedAt = new Date().toISOString();
        await getStorage().updateTask(task);
        await recordAudit({ actionType: 'task.failed', taskId: task.taskId, actorRole: input.actorRole || 'user', outcome: 'failed', verificationStatus: 'not-verified', error: task.lastError, capabilityUsed: 'web.fetch/read', providerName: 'web-fetch' });
        return { ...task, progress: [...task.progress] };
      }
    }
    if (task.requiredCapability === 'web.search') {
      task.status = 'executing';
      task.progress.push('Read-only web search execution started.');
      const query = searchQuery(task.goal);
      try {
        const research = await researchWeb(query, undefined, input.searchProvider);
        const response = research.response;
        const verifiedAt = new Date().toISOString();
        const formatted = formatSearchResult(response, verifiedAt);
        task.webSearch = { query: response.query, provider: response.provider, results: response.results, summary: formatted.summary };
        task.sources = research.sources;
        task.result = formatted.text;
        task.executionEvidence = `Provider ${response.provider} returned a valid response with ${response.results.length} normalized result(s) at ${research.retrievedAt}.`;
        task.verificationResult = `Verified provider response from ${response.provider}; result count ${response.results.length}; normalized source metadata retained; timestamp ${verifiedAt}.`;
        task.status = 'completed';
        task.verificationStatus = 'verified';
        task.finalResult = task.result;
        task.progress.push(task.finalResult);
        task.lastSuccessfulStep = task.finalResult;
        task.updatedAt = verifiedAt;
        await getStorage().updateTask(task);
        await recordAudit({ actionType: 'task.completed', taskId: task.taskId, actorRole: input.actorRole || 'user', outcome: 'completed', verificationStatus: 'verified', capabilityUsed: 'web.search', query: response.query, providerName: response.provider, resultCount: response.results.length, verificationResult: task.verificationResult, lifecycleTransitions: [
          { state: 'created', timestamp: task.createdAt }, { state: 'classified', timestamp: verifiedAt, evidence: 'web.search' }, { state: 'planned', timestamp: verifiedAt, evidence: task.executionPlan.validationRequirement }, { state: 'executing', timestamp: verifiedAt, evidence: task.executionEvidence }, { state: 'verifying', timestamp: verifiedAt, evidence: task.verificationResult }, { state: 'completed', timestamp: verifiedAt, evidence: task.finalResult },
        ] });
        return { ...task, progress: [...task.progress] };
      } catch (error) {
        task.status = 'failed';
        task.lastError = error instanceof WebSearchProviderError ? error.message : error instanceof Error ? error.message : 'Web search provider failed unexpectedly';
        task.progress.push(`Failed: ${task.lastError}.`);
        task.updatedAt = new Date().toISOString();
        await getStorage().updateTask(task);
        await recordAudit({ actionType: 'task.failed', taskId: task.taskId, actorRole: input.actorRole || 'user', outcome: 'failed', verificationStatus: 'not-verified', error: task.lastError, capabilityUsed: 'web.search', query, providerName: process.env.KC_AI_WEB_SEARCH_PROVIDER || 'unknown', resultCount: 0 });
        return { ...task, progress: [...task.progress] };
      }
    }
    task.status = 'blocked';
    task.blockedReason = 'Capability is registered but has no executable adapter';
    task.result = generateBlockedResult(task.requiredCapability, task.blockedReason);
    task.lastError = task.blockedReason;
    task.progress.push(`Blocked: ${task.blockedReason}.`);
    task.updatedAt = new Date().toISOString();
    await getStorage().updateTask(task);
    await recordAudit({ actionType: 'task.blocked', taskId: task.taskId, actorRole: input.actorRole || 'user', outcome: 'blocked', verificationStatus: 'not-verified', error: task.blockedReason, capabilityUsed: task.requiredCapability, lifecycleTransitions: ['created', 'classified', 'planned', 'blocked'].map((state) => ({ state, timestamp: task.updatedAt, evidence: state === 'blocked' ? task.blockedReason : task.requiredCapability })) });
    return { ...task, progress: [...task.progress] };
  }

  task.status = 'executing';
  task.progress.push('Internal task execution started.');
  try {
    task.result = input.executeInternal
      ? await input.executeInternal()
      : generateInternalResult(task.goal);
    task.executionEvidence = task.result;
  } catch (error) {
    task.status = 'failed';
    task.lastError = error instanceof Error ? error.message : 'Internal task execution failed';
    task.progress.push(`Failed: ${task.lastError}.`);
    task.updatedAt = new Date().toISOString();
    await getStorage().updateTask(task);
    await recordAudit({ actionType: 'task.failed', taskId: task.taskId, actorRole: input.actorRole || 'user', outcome: 'failed', verificationStatus: 'not-verified', error: task.lastError, capabilityUsed: task.requiredCapability });
    return { ...task, progress: [...task.progress] };
  }
  await getStorage().updateTask(task);
  task.status = 'verifying';
  task.progress.push('Verifying internal execution evidence.');
  try {
    task.verificationResult = task.executionEvidence
      ? (input.verifyInternal ? await input.verifyInternal(task.executionEvidence) : 'Verified internal execution evidence is present.')
      : undefined;
  } catch (error) {
    task.verificationResult = undefined;
    task.lastError = error instanceof Error ? `Verification failed: ${error.message}` : 'Verification failed';
  }
  await getStorage().updateTask(task);
  if (!task.verificationResult) {
    task.status = 'failed';
    task.lastError ||= 'Execution completed without verifiable evidence';
    task.progress.push(`Failed: ${task.lastError}.`);
    task.updatedAt = new Date().toISOString();
    await getStorage().updateTask(task);
    await recordAudit({ actionType: 'task.failed', taskId: task.taskId, actorRole: input.actorRole || 'user', outcome: 'failed', verificationStatus: 'not-verified', error: task.lastError, capabilityUsed: task.requiredCapability });
    return { ...task, progress: [...task.progress] };
  }
  task.status = 'completed';
  task.verificationStatus = 'verified';
  task.finalResult = task.result!;
  task.progress.push(task.finalResult);
  task.lastSuccessfulStep = task.finalResult;
  task.updatedAt = new Date().toISOString();
  await getStorage().updateTask(task);
  await recordAudit({ actionType: 'task.completed', taskId: task.taskId, actorRole: input.actorRole || 'user', outcome: 'completed', verificationStatus: 'verified', capabilityUsed: task.requiredCapability, verificationResult: task.verificationResult, lifecycleTransitions: [
    { state: 'created', timestamp: task.createdAt },
    { state: 'classified', timestamp: task.updatedAt, evidence: task.requiredCapability },
    { state: 'planned', timestamp: task.updatedAt, evidence: task.executionPlan.validationRequirement },
    { state: 'executing', timestamp: task.updatedAt, evidence: task.executionEvidence },
    { state: 'verifying', timestamp: task.updatedAt, evidence: task.verificationResult },
    { state: 'completed', timestamp: task.updatedAt, evidence: task.finalResult },
  ] });
  return { ...task, progress: [...task.progress] };
}

export function getTask(taskId: string): Promise<TaskRecord | undefined> {
  return getStorage().getTask(taskId);
}

export function listTasks(): Promise<TaskRecord[]> {
  return getStorage().listTasks();
}

export function listTaskHistory(taskId: string) { return getStorage().listTaskHistory(taskId); }

export async function reloadTasks(): Promise<void> { await getStorage().initialize(); }
