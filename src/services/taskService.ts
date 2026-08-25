import { createHash, randomUUID } from 'node:crypto';
import { checkCapability, listCapabilities } from './capabilityService';
import { recordAudit } from './auditService';
import { getStorage } from './storage';
import { createHealthResponse } from './healthService';
import type { TaskRecord } from '../types/task';
import { WebSearchProviderError, type SearchProvider, type WebSearchResponse } from './webSearchService';
import { redactSensitive } from './auditService';
import { researchWeb } from './browserResearchService';
import { extractReadableContent, fetchWebPage, WebFetchError } from './webFetchService';

export function classifyGoal(goal: string): string {
  const normalized = goal.toLowerCase();
  const explicitResearch = /\b(search|research|browse|look up|lookup)\b/.test(normalized);
  const researchOnly = explicitResearch && !/\b(build(?:ing)?|implement|refactor|fix|test|development)\b/.test(normalized);
  const explicitMessageSend = (/\b(send|sending|deliver|delivering|forward|forwarding)\b/.test(normalized) &&
    /\b(message|text|sms|notification|notify|messaging)\b/.test(normalized) &&
    (/\b(to|for|via|through|externally|recipient|customer|user|contact|number)\b/.test(normalized) || /@/.test(normalized))) ||
    /\bmessage\s+(?:this|that|the|a|an)\s+(?:customer|user|contact|number|recipient)\b/.test(normalized);
  const explicitEmailSend = /\b(send|sending)\b.*\b(email|e-mail)\b|\b(email|e-mail)\b.*\b(send|sending)\b/.test(normalized);
  const explicitExternalAction = explicitMessageSend || explicitEmailSend || /\b(transfer|pay|payment|deploy|deployment|publish|release|ship)\b/.test(normalized);
  const developmentGoal = !explicitExternalAction && !researchOnly && !/\b(private build|private development|staging build)\b/.test(normalized) &&
    (/\b(build|implement|refactor|fix|test|architecture|ui|capability|repository|commit|push|main branch|software|development)\b/.test(normalized) ||
    (/\b(architecture|capability)\b/.test(normalized) && !explicitResearch) ||
    (/\b(build|fix|test)\b/.test(normalized) && /\b(kc browser|code|feature|function|interface|unit test|spec|repository|software)\b/.test(normalized)));
  if (developmentGoal) return 'task.orchestration';
  if (/\b(fetch|read|open|retrieve)\b/.test(normalized) && /https?:\/\/\S+/.test(normalized)) return 'web.fetch/read';
  if (/\b(send|sending|email|e-mail)\b/.test(normalized) && /\b(email|e-mail)\b/.test(normalized)) return 'email.send';
  if (/\b(send|deliver|message)\b/.test(normalized) && /\b(to|for|via|through|externally|recipient|customer|user|contact|number|@)\b/.test(normalized) && /\b(message|text|sms|messaging|notification|notify)\b/.test(normalized)) return 'message.send';
  if (/\b(pay|payment|payments|transfer|transfers|wire|refund|purchase|charge)\b/.test(normalized)) return 'payment.transfer';
  if (/\b(deploy|deployment|publish|publishing|release|ship)\b/.test(normalized)) return 'deployment.execute';
  if (/\b(delete|deletion|remove|removal|erase|destroy)\b/.test(normalized) && /\b(file|files|folder|folders|record|records|data)\b/.test(normalized)) return 'file.delete';
  if (/\b(search|browse|look up|lookup)\b/.test(normalized) && /\b(web|internet|online)\b/.test(normalized)) return 'web.search';
  if (/\b(research|investigate|find multiple sources|compare sources)\b/.test(normalized) && /\b(web|internet|online|sources?|research)\b/.test(normalized)) return 'browser.research';
  if (/\b(private build|private development|staging build)\b/.test(normalized)) return 'owner.private-build';
  if (/\b(change|update|modify|edit|create|close|delete|reset)\b/.test(normalized) && /\b(account|profile|password|subscription|settings|permissions|user)\b/.test(normalized)) return 'account.changes';
  if (/\b(api|webhook|external service|third-party|third party|integration)\b/.test(normalized)) return 'external-api.action';
  if (normalized.includes('database') || normalized.includes('product data')) return 'kc-product-data';
  return 'task.orchestration';
}

function capabilityMatchesGoal(goal: string, capability: string): boolean {
  const normalized = goal.toLowerCase();
  const requirements: Record<string, RegExp> = {
    'web.fetch/read': /\b(fetch|read|open|retrieve)\b.*https?:\/\/\S+|https?:\/\/\S+.*\b(fetch|read|open|retrieve)\b/i,
    'email.send': /\b(send|sending|email|e-mail)\b.*\b(email|e-mail)\b/i,
    'message.send': /\b(send|sending|message|messaging|text|sms|notify|notification)\b/i,
    'payment.transfer': /\b(pay|payment|payments|transfer|transfers|wire|refund|purchase|charge)\b/i,
    'deployment.execute': /\b(deploy|deployment|publish|publishing|release|ship)\b/i,
    'file.delete': /\b(delete|deletion|remove|removal|erase|destroy)\b.*\b(file|files|folder|folders|record|records|data)\b/i,
    'web.search': /\b(search|browse|look up|lookup)\b.*\b(web|internet|online)\b|\b(web|internet|online)\b.*\b(search|browse|look up|lookup)\b/i,
    'browser.research': /\b(research|investigate|find multiple sources|compare sources)\b.*\b(web|internet|online|sources?|research)\b|\b(web|internet|online|sources?)\b.*\b(research|investigate|find multiple sources|compare sources)\b/i,
    'owner.private-build': /\b(private build|private development|staging build)\b/i,
    'account.changes': /\b(change|update|modify|edit|create|close|delete|reset)\b.*\b(account|profile|password|subscription|settings|permissions|user)\b/i,
    'external-api.action': /\b(api|webhook|external service|third-party|third party|integration)\b/i,
    'kc-product-data': /database|product data/i,
  };
  return capability === 'task.orchestration' || Boolean(requirements[capability]?.test(normalized));
}

function classifyCurrentGoal(goal: string): string {
  const capability = classifyGoal(goal);
  return capabilityMatchesGoal(goal, capability) ? capability : 'task.orchestration';
}

function goalHash(goal: string): string {
  return createHash('sha256').update(goal).digest('hex');
}

function explicitTaskReference(goal: string, continuationTaskId?: string): string | undefined {
  if (!continuationTaskId) return undefined;
  return /\b(continue|retry)\b.*\b(previous|prior|that)(?:\s+\w+){0,3}\s+task\b|\bcontinue\s+from\s+task\b/i.test(goal)
    ? continuationTaskId
    : undefined;
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

function requestedSourceCount(goal: string): number | undefined {
  const match = goal.match(/\b(\d+)\s+sources?\b/i);
  return match ? Math.max(Number(match[1]), 1) : undefined;
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
  continuationTaskId?: string;
}): Promise<TaskRecord> {
  const rawGoal = input.goal;
  const normalizedGoal = rawGoal.trim();
  const now = new Date().toISOString();
  const reference = explicitTaskReference(normalizedGoal, input.continuationTaskId);
  const referencedTask = reference ? await getStorage().getTask(reference) : undefined;
  const referencedCapability = referencedTask?.requiredCapability;
  const contextId = `context_${randomUUID()}`;
  const rawGoalHash = goalHash(rawGoal);
  const executionContext: TaskRecord['executionContext'] = { contextId, rawGoalHash, classificationTimestamp: now, priorContextUsed: Boolean(reference), explicitTaskReference: reference };
  const task: TaskRecord = {
    taskId: `task_${randomUUID()}`,
    goal: normalizedGoal,
    privateBuildId: input.privateBuildId,
    appContext: input.appId || input.appName ? { appId: input.appId, appName: input.appName } : undefined,
    status: 'created',
    createdAt: now,
    updatedAt: now,
    progress: ['Task created.'],
    verificationStatus: 'not-verified',
    executionContext,
  };
  await getStorage().createTask(task);
  await recordAudit({ actionType: 'task.received', taskId: task.taskId, actorRole: input.actorRole || 'user', outcome: 'started', verificationStatus: 'not-verified', goalHash: rawGoalHash, priorContextUsed: Boolean(reference), explicitTaskReference: reference });

  task.requiredCapability = referencedCapability && reference ? referencedCapability : classifyCurrentGoal(task.goal);
  task.understanding = understand(task.goal, task.requiredCapability);
  executionContext.classificationTimestamp = new Date().toISOString();
  await recordAudit({ actionType: 'task.classified', taskId: task.taskId, actorRole: input.actorRole || 'user', outcome: 'started', verificationStatus: 'not-verified', goalHash: rawGoalHash, classification: task.requiredCapability, classificationTimestamp: executionContext.classificationTimestamp, priorContextUsed: executionContext.priorContextUsed, explicitTaskReference: executionContext.explicitTaskReference, capabilityUsed: task.requiredCapability });
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
        const extracted = page.title && page.summary ? { title: page.title, summary: page.summary } : extractReadableContent(page.content, page.contentType);
        task.result = `RETRIEVED SOURCE\nTitle: ${extracted.title}\nURL: ${page.url}\nRetrieved at: ${page.retrievedAt}\nReadable summary: ${extracted.summary}\nCapability: web.fetch/read\nVerification: Public page retrieved as untrusted data; no webpage instructions were executed.`;
        task.sources = [{ title: extracted.title, url: page.url, domain: new URL(page.url).hostname, snippet: extracted.summary, provider: 'web.fetch/read', retrievedAt: page.retrievedAt }];
        task.executionEvidence = `Retrieved readable content from ${page.url}; webpage content remained untrusted data.`;
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
    if (task.requiredCapability === 'browser.research') {
      task.status = 'executing';
      task.progress.push('Read-only browser research execution started.');
      const query = searchQuery(task.goal);
      try {
        const research = await researchWeb(query, undefined, input.searchProvider);
        const targetCount = requestedSourceCount(task.goal);
        const readableSources: Array<{ title: string; url: string; summary: string; retrievedAt: string }> = [];
        for (const source of research.sources) {
          if (targetCount !== undefined && readableSources.length >= targetCount) break;
          try {
            const page = await (input.fetchPage || fetchWebPage)(source.url);
            const extracted = page.title && page.summary ? { title: page.title, summary: page.summary } : extractReadableContent(page.content, page.contentType);
            readableSources.push({ title: extracted.title, url: page.url, summary: extracted.summary, retrievedAt: page.retrievedAt });
          } catch { }
        }
        const verifiedAt = new Date().toISOString();
        task.sources = readableSources.map((source) => ({ title: source.title, url: source.url, domain: new URL(source.url).hostname, snippet: source.summary, provider: research.response.provider, retrievedAt: source.retrievedAt }));
        task.result = `RESEARCH\nQuery: ${redactSensitive(query)}\nSources selected: ${research.sources.length}\nSources fetched safely: ${readableSources.length}\n\n${readableSources.map((source, index) => `${index + 1}. ${source.title}\n${source.url}\n${source.summary}`).join('\n\n')}\n\nVERIFICATION\nSearch provider ${research.response.provider} returned normalized sources at ${research.retrievedAt}. Fetched page content was treated as UNTRUSTED DATA; no webpage instructions were executed.\nFinal status: ${readableSources.length ? 'completed' : 'unavailable'}`;
        task.executionEvidence = `Provider ${research.response.provider} returned ${research.sources.length} source(s); ${readableSources.length} public source(s) passed safe retrieval.`;
        task.verificationResult = `Verified read-only browser research at ${verifiedAt}; source URLs and retrieval timestamps retained; page instructions were not executed.`;
        task.status = readableSources.length ? 'completed' : 'failed';
        task.verificationStatus = readableSources.length ? 'verified' : 'not-verified';
        task.finalResult = task.result;
        task.progress.push(task.result);
        task.lastSuccessfulStep = readableSources.length ? task.result : undefined;
        task.lastError = readableSources.length ? undefined : 'No selected research source could be safely retrieved';
        task.updatedAt = verifiedAt;
        await getStorage().updateTask(task);
        await recordAudit({ actionType: readableSources.length ? 'task.completed' : 'task.failed', taskId: task.taskId, actorRole: input.actorRole || 'user', outcome: readableSources.length ? 'completed' : 'failed', verificationStatus: task.verificationStatus, capabilityUsed: 'browser.research', providerName: research.response.provider, resultCount: research.sources.length, verificationResult: task.verificationResult });
        return { ...task, progress: [...task.progress] };
      } catch (error) {
        task.status = 'failed';
        task.lastError = error instanceof WebSearchProviderError ? error.message : error instanceof Error ? error.message : 'Browser research failed unexpectedly';
        task.progress.push(`Failed: ${task.lastError}.`);
        task.updatedAt = new Date().toISOString();
        await getStorage().updateTask(task);
        await recordAudit({ actionType: 'task.failed', taskId: task.taskId, actorRole: input.actorRole || 'user', outcome: 'failed', verificationStatus: 'not-verified', error: task.lastError, capabilityUsed: 'browser.research' });
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
