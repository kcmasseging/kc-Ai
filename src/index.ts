import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { env, allowedOrigins } from './config/env';
import { createHealthResponse } from './services/healthService';
import { createWelcomeMessage } from './services/welcomeService';
import { createSessionRecord } from './services/sessionService';
import { generateChatReply, ChatRequestSchema } from './services/chatService';
import { createTtsResponse } from './services/ttsService';
import { listCapabilities } from './services/capabilityService';
import { createAndAdvanceTask, getTask, listTaskHistory, listTasks } from './services/taskService';
import { listAuditRecords } from './services/auditService';
import { initializeStorage, LocalStorage, configureStorage } from './services/storage';
import { PostgresStorage } from './services/postgresStorage';
import { createOwnerWallet, deriveWalletBalances, getOwnerWallet, listWalletRails, mutateOwnerWallet, resolveWalletRoute, reverseOwnerWalletTransaction, WalletOperationError } from './services/walletService';
import { authenticateOwner, authConfigurationStatus, initializeOwner, issueStepUpToken, logoutOwner, verifyOwnerSession, verifyStepUpTokenForSession } from './services/authService';
import { SecretBus, type SecretType } from './services/secretBusService';
import { advancePrivateBuild, createPrivateBuild, getPrivateBuild, type PrivateBuildStatus } from './services/privateBuildService';
import { verifySystem } from './services/systemVerificationService';
import { HealthWatchService } from './services/healthWatchService';
import { applyCorrection, approveProjectIntent, createProjectIntent, loadProjectIntent, recordRejectedRequirement, recordUnresolvedQuestion, summarizeProjectIntent, toBuilderHandoff, toProjectSpecification, updateProjectIntent } from './services/projectIntentService';
import { understandOwnerMessage } from './services/conversationUnderstandingService';
import { loadOwnerProfile, updateOwnerProfile } from './services/ownerProfileService';

const app = express();
const port = env.KC_AI_PORT;
const secretBus = new SecretBus(env.KC_AI_SECRET_BUS_KEY);
configureStorage(env.KC_AI_STORAGE_DRIVER === 'postgres' ? new PostgresStorage({ connectionString: env.KC_AI_DATABASE_URL }) : new LocalStorage());
const storageReady = initializeStorage();
const healthWatch = new HealthWatchService();
healthWatch.register({ product: 'KC AI', async check() {
  try { await listTasks(); return { checks: [{ area: 'application availability', status: 'HEALTHY', evidence: JSON.stringify(createHealthResponse(env.KC_AI_ENV)) }] }; }
  catch { return { checks: [{ area: 'storage', status: 'UNAVAILABLE', evidence: 'KC AI storage check failed' }] }; }
} });

function bearerToken(req: Request): string | undefined {
  const authorization = req.headers.authorization;
  return authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
}

function ownerClaims(req: Request) {
  return verifyOwnerSession(bearerToken(req), env.KC_AI_JWT_SECRET);
}

function requireOwner(req: Request, res: Response, next: NextFunction): void {
  const claims = ownerClaims(req);
  if (!claims) {
    res.status(401).json({ error: 'Authenticated Owner Mode is required' });
    return;
  }
  res.locals.owner = claims;
  next();
}

function requireStepUp(req: Request, res: Response, next: NextFunction): void {
  const claims = ownerClaims(req);
  if (!claims || !verifyStepUpTokenForSession(req.headers['x-kc-step-up'] as string | undefined, claims.sessionId)) {
    res.status(403).json({ error: 'Recent owner re-authentication is required', requiredAction: 'POST /api/v1/auth/reauthenticate' });
    return;
  }
  next();
}

function requirePrivateBuild(req: Request, res: Response, next: NextFunction): void {
  const privateBuildId = Array.isArray(req.params.privateBuildId) ? req.params.privateBuildId[0] : req.params.privateBuildId;
  const build = privateBuildId ? getPrivateBuild(privateBuildId, res.locals.owner.subject) : undefined;
  if (!build) {
    res.status(404).json({ error: 'Private Build Mode context not found' });
    return;
  }
  res.locals.privateBuild = build;
  next();
}

app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-KC-Step-Up');

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }

  next();
});

app.use(async (_req, res, next) => {
  try { await storageReady; next(); }
  catch { res.status(503).json({ error: 'Configured durable storage is unavailable' }); }
});

app.get('/health', (_req: Request, res: Response) => {
  res.json(createHealthResponse(env.KC_AI_ENV));
});

app.post('/api/v1/welcome', (req: Request, res: Response) => {
  const payload = req.body ?? {};

  const welcome = createWelcomeMessage({
    userName: payload.userName,
    appId: payload.appId,
    appName: payload.appName,
    ecosystem: Array.isArray(payload.ecosystem) ? payload.ecosystem : undefined,
  });

  const session = createSessionRecord({
    sessionId: payload.sessionId,
    userId: payload.userId,
    appId: payload.appId,
    appName: payload.appName,
    greetingShown: true,
  });

  res.json({
    session,
    welcome,
    voiceEnabled: env.KC_AI_ENABLE_VOICE,
  });
});

app.post('/api/v1/chat', async (req: Request, res: Response) => {
  const parsed = ChatRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid chat payload',
      details: parsed.error.flatten(),
    });
    return;
  }

  const owner = ownerClaims(req);
  const sessionId = parsed.data.sessionId || owner?.sessionId || `session_${owner?.subject || parsed.data.userId || 'public'}_${req.ip}`;
  const response = owner
    ? await understandOwnerMessage({ ownerId: owner.subject, sessionId, message: parsed.data.message })
    : generateChatReply({ ...parsed.data, sessionId });
  res.json(response);
});

app.post('/api/v1/tts', (req: Request, res: Response) => {
  const payload = req.body ?? {};
  const response = createTtsResponse({
    text: payload.text ?? 'Hello from KC AI.',
    voice: payload.voice,
    provider: payload.provider,
  });

  res.json(response);
});

app.post('/api/v1/auth/login', async (req: Request, res: Response) => {
  const ownerId = typeof req.body?.ownerId === 'string' ? req.body.ownerId : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const result = await authenticateOwner({ ownerId, password, secret: env.KC_AI_JWT_SECRET });
  if (!result) {
    res.status(401).json({ error: 'Invalid owner credentials or authentication is not configured' });
    return;
  }
  res.json(result);
});

app.post('/api/v1/auth/initialize', (req: Request, res: Response) => {
  const setupSecret = typeof req.body?.setupSecret === 'string' ? req.body.setupSecret : '';
  const passwordHash = typeof req.body?.passwordHash === 'string' ? req.body.passwordHash : '';
  if (!initializeOwner({ setupSecret, passwordHash })) {
    res.status(403).json({ error: 'Owner initialization is unavailable or the setup secret is invalid' });
    return;
  }
  res.json({ ownerId: env.KC_AI_OWNER_ID, passwordHash, initializationComplete: true });
});

app.post('/api/v1/auth/logout', requireOwner, async (req: Request, res: Response) => {
  await logoutOwner(bearerToken(req), env.KC_AI_JWT_SECRET);
  res.status(204).send();
});

app.post('/api/v1/auth/reauthenticate', requireOwner, async (req: Request, res: Response) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const token = await issueStepUpToken({ token: bearerToken(req), password, secret: env.KC_AI_JWT_SECRET });
  if (!token) {
    res.status(401).json({ error: 'Owner re-authentication failed' });
    return;
  }
  res.json({ stepUpToken: token, expiresInSeconds: 300 });
});

app.get('/api/v1/owner/profile', requireOwner, async (_req: Request, res: Response) => {
  res.json({ profile: await loadOwnerProfile(res.locals.owner.subject) });
});

app.patch('/api/v1/owner/profile', requireOwner, async (req: Request, res: Response) => {
  const body = req.body ?? {};
  if (body.displayName !== undefined && typeof body.displayName !== 'string') { res.status(400).json({ error: 'displayName must be a string' }); return; }
  if (body.preferences !== undefined && (typeof body.preferences !== 'object' || Array.isArray(body.preferences))) { res.status(400).json({ error: 'preferences must be an object' }); return; }
  const arrays = ['workingContext', 'authorizationNotes'] as const;
  if (arrays.some((field) => body[field] !== undefined && (!Array.isArray(body[field]) || body[field].some((value: unknown) => typeof value !== 'string')))) { res.status(400).json({ error: 'Profile lists must contain strings' }); return; }
  res.json({ profile: await updateOwnerProfile({ ownerId: res.locals.owner.subject, displayName: body.displayName, preferences: body.preferences, workingContext: body.workingContext, authorizationNotes: body.authorizationNotes }) });
});

app.post('/api/v1/owner/tasks', requireOwner, async (req: Request, res: Response) => {
  if (typeof req.body?.goal !== 'string' || !req.body.goal.trim()) { res.status(400).json({ error: 'A non-empty task goal is required' }); return; }
  const profile = await loadOwnerProfile(res.locals.owner.subject);
  const task = await createAndAdvanceTask({ goal: req.body.goal, actorRole: 'owner', appId: 'kc-robot', appName: 'KC Robot', ownerProfile: profile });
  res.status(task.status === 'blocked' ? 409 : 201).json({ task });
});

app.post('/api/v1/owner/project-intents', requireOwner, async (req: Request, res: Response) => {
  if (typeof req.body?.statement !== 'string' || !req.body.statement.trim()) { res.status(400).json({ error: 'A non-empty project statement is required' }); return; }
  const intent = await createProjectIntent({ ownerId: res.locals.owner.subject, statement: req.body.statement, projectId: typeof req.body.projectId === 'string' ? req.body.projectId : undefined });
  res.status(201).json({ intent, summary: summarizeProjectIntent(intent), specification: toProjectSpecification(intent) });
});

app.get('/api/v1/owner/project-intents/:projectId', requireOwner, async (req: Request, res: Response) => {
  const projectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const intent = await loadProjectIntent(projectId, res.locals.owner.subject);
  if (!intent) { res.status(404).json({ error: 'Project intent not found' }); return; }
  res.json({ intent, summary: summarizeProjectIntent(intent), specification: toProjectSpecification(intent) });
});

app.patch('/api/v1/owner/project-intents/:projectId', requireOwner, async (req: Request, res: Response) => {
  const projectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  if (typeof req.body?.statement !== 'string' || !req.body.statement.trim()) { res.status(400).json({ error: 'A non-empty project statement is required' }); return; }
  try {
    const intent = req.body.correction === true
      ? await applyCorrection({ projectId, ownerId: res.locals.owner.subject, statement: req.body.statement })
      : await updateProjectIntent({ projectId, ownerId: res.locals.owner.subject, statement: req.body.statement });
    res.json({ intent, summary: summarizeProjectIntent(intent), specification: toProjectSpecification(intent) });
  } catch { res.status(404).json({ error: 'Project intent not found' }); }
});

app.post('/api/v1/owner/project-intents/:projectId/approve', requireOwner, async (req: Request, res: Response) => {
  const projectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  try { const intent = await approveProjectIntent({ projectId, ownerId: res.locals.owner.subject }); res.json({ intent, specification: toProjectSpecification(intent) }); }
  catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : 'Project specification cannot be approved' }); }
});

app.get('/api/v1/owner/project-intents/:projectId/handoff', requireOwner, async (req: Request, res: Response) => {
  const projectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const intent = await loadProjectIntent(projectId, res.locals.owner.subject);
  if (!intent) { res.status(404).json({ error: 'Project intent not found' }); return; }
  try { res.json({ handoff: toBuilderHandoff(intent) }); } catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : 'Project specification is not approved' }); }
});

app.post('/api/v1/owner/project-intents/:projectId/rejections', requireOwner, async (req: Request, res: Response) => {
  const projectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  if (typeof req.body?.requirement !== 'string' || !req.body.requirement.trim()) { res.status(400).json({ error: 'A requirement is required' }); return; }
  try { res.json({ intent: await recordRejectedRequirement({ projectId, ownerId: res.locals.owner.subject, requirement: req.body.requirement }) }); }
  catch { res.status(404).json({ error: 'Project intent not found' }); }
});

app.post('/api/v1/owner/project-intents/:projectId/questions', requireOwner, async (req: Request, res: Response) => {
  const projectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  if (typeof req.body?.question !== 'string' || !req.body.question.trim()) { res.status(400).json({ error: 'A question is required' }); return; }
  try { res.json({ intent: await recordUnresolvedQuestion({ projectId, ownerId: res.locals.owner.subject, question: req.body.question }) }); }
  catch { res.status(404).json({ error: 'Project intent not found' }); }
});

app.post('/api/v1/owner/system-verification', requireOwner, async (req: Request, res: Response) => {
  if (req.body?.message !== 'KC AI, verify your system.') {
    res.status(400).json({ error: 'Use the exact system verification request' });
    return;
  }
  res.json(await verifySystem(env.KC_AI_ENV, secretBus));
});

app.post('/api/v1/owner/health-watch/scan', requireOwner, async (_req: Request, res: Response) => {
  res.json({ snapshots: await healthWatch.scan(), scheduler: 'NOT_CONFIGURED' });
});

app.get('/api/v1/owner/health-watch/issues', requireOwner, (_req: Request, res: Response) => {
  res.json({ issues: healthWatch.listIssues() });
});

app.post('/api/v1/owner/private-build', requireOwner, requireStepUp, async (req: Request, res: Response) => {
  if (typeof req.body?.goal !== 'string' || req.body.goal.trim().length === 0) {
    res.status(400).json({ error: 'A non-empty private build goal is required' });
    return;
  }
  res.status(201).json({ build: await createPrivateBuild({ ownerId: res.locals.owner.subject, goal: req.body.goal }) });
});

app.get('/api/v1/owner/private-build/:privateBuildId', requireOwner, requirePrivateBuild, (_req: Request, res: Response) => {
  res.json({ build: res.locals.privateBuild });
});

app.post('/api/v1/owner/private-build/:privateBuildId/tasks', requireOwner, requireStepUp, requirePrivateBuild, async (req: Request, res: Response) => {
  if (typeof req.body?.goal !== 'string' || req.body.goal.trim().length === 0) {
    res.status(400).json({ error: 'A non-empty private build task goal is required' });
    return;
  }
  const task = await createAndAdvanceTask({ goal: req.body.goal, privateBuildId: res.locals.privateBuild.privateBuildId, actorRole: 'owner' });
  res.status(task.status === 'blocked' ? 409 : 201).json({ task });
});

app.post('/api/v1/owner/private-build/:privateBuildId/transition', requireOwner, requireStepUp, requirePrivateBuild, async (req: Request, res: Response) => {
  const target = req.body?.target;
  const statuses: PrivateBuildStatus[] = ['PRIVATE_BUILD', 'VALIDATED', 'OWNER_REVIEW_REQUIRED', 'APPROVED_FOR_STAGING', 'APPROVED_FOR_PRODUCTION'];
  if (typeof target !== 'string' || !statuses.includes(target as PrivateBuildStatus)) {
    res.status(400).json({ error: 'A valid private build lifecycle target is required' });
    return;
  }
  const build = await advancePrivateBuild(res.locals.privateBuild.privateBuildId, res.locals.owner.subject, target as PrivateBuildStatus);
  if (!build) {
    res.status(409).json({ error: 'Private Build Mode lifecycle transition is not valid' });
    return;
  }
  res.json({ build });
});

app.post('/api/v1/owner/private-build/:privateBuildId/wallet', requireOwner, requireStepUp, requirePrivateBuild, async (_req: Request, res: Response) => {
  try { res.status(201).json({ wallet: await createOwnerWallet(res.locals.owner.subject) }); }
  catch (error) { res.status(error instanceof WalletOperationError ? 409 : 503).json({ error: error instanceof Error ? error.message : 'Wallet unavailable' }); }
});

app.get('/api/v1/owner/private-build/:privateBuildId/wallet', requireOwner, requirePrivateBuild, async (_req: Request, res: Response) => {
  try {
    const wallet = await getOwnerWallet(res.locals.owner.subject);
    if (!wallet) { res.status(404).json({ error: 'Owner wallet not found' }); return; }
    res.json({ wallet, balances: deriveWalletBalances(wallet.ledger) });
  } catch (error) { res.status(error instanceof WalletOperationError ? 404 : 503).json({ error: error instanceof Error ? error.message : 'Wallet unavailable' }); }
});

app.get('/api/v1/owner/private-build/:privateBuildId/wallet/rails', requireOwner, requirePrivateBuild, (_req: Request, res: Response) => {
  res.json({ rails: listWalletRails() });
});

app.post('/api/v1/owner/private-build/:privateBuildId/wallet/route', requireOwner, requirePrivateBuild, (req: Request, res: Response) => {
  if (typeof req.body?.country !== 'string' || typeof req.body?.currency !== 'string' || typeof req.body?.rail !== 'string' || typeof req.body?.amountMinor !== 'string') { res.status(400).json({ error: 'country, currency, rail, and amountMinor are required' }); return; }
  res.status(200).json({ route: resolveWalletRoute({ country: req.body.country, currency: req.body.currency, rail: req.body.rail, amountMinor: req.body.amountMinor }) });
});

app.post('/api/v1/owner/private-build/:privateBuildId/wallet/mutations', requireOwner, requireStepUp, requirePrivateBuild, async (req: Request, res: Response) => {
  try {
    const direction = req.body?.direction;
    if (direction !== 'CREDIT' && direction !== 'DEBIT') { res.status(400).json({ error: 'direction must be CREDIT or DEBIT' }); return; }
    const result = await mutateOwnerWallet({ ownerId: res.locals.owner.subject, direction, currency: req.body.currency, amountMinor: req.body.amountMinor, idempotencyKey: req.body.idempotencyKey, reference: req.body.reference });
    res.status(result.duplicate ? 200 : 201).json({ transaction: result.transaction, duplicate: result.duplicate });
  } catch (error) { res.status(error instanceof WalletOperationError ? 409 : 503).json({ error: error instanceof Error ? error.message : 'Wallet mutation unavailable' }); }
});

app.post('/api/v1/owner/private-build/:privateBuildId/wallet/reversals', requireOwner, requireStepUp, requirePrivateBuild, async (req: Request, res: Response) => {
  try {
    const result = await reverseOwnerWalletTransaction({ ownerId: res.locals.owner.subject, transactionId: req.body?.transactionId, idempotencyKey: req.body?.idempotencyKey, reference: req.body?.reference });
    res.status(result.duplicate ? 200 : 201).json({ transaction: result.transaction, duplicate: result.duplicate });
  } catch (error) { res.status(error instanceof WalletOperationError ? 409 : 503).json({ error: error instanceof Error ? error.message : 'Wallet reversal unavailable' }); }
});

app.get('/api/v1/capabilities', (_req: Request, res: Response) => {
  res.json({ capabilities: listCapabilities() });
});

app.post('/api/v1/tasks', async (req: Request, res: Response) => {
  if (typeof req.body?.goal !== 'string' || req.body.goal.trim().length === 0) {
    res.status(400).json({ error: 'A non-empty goal is required' });
    return;
  }

  const task = await createAndAdvanceTask({
    goal: req.body.goal,
    appId: req.body.appId,
    appName: req.body.appName,
    actorRole: ownerClaims(req) ? 'owner' : 'user',
    continuationTaskId: typeof req.body.continuationTaskId === 'string' ? req.body.continuationTaskId : undefined,
  });
  res.status(task.status === 'blocked' ? 409 : 201).json({ task });
});

app.get('/api/v1/tasks/:taskId', async (req: Request, res: Response) => {
  const taskId = Array.isArray(req.params.taskId) ? req.params.taskId[0] : req.params.taskId;
  const task = await getTask(taskId);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json({ task });
});

app.get('/api/v1/tasks', async (_req: Request, res: Response) => {
  res.json({ tasks: await listTasks() });
});

app.get('/api/v1/tasks/:taskId/history', async (req: Request, res: Response) => {
  const taskId = Array.isArray(req.params.taskId) ? req.params.taskId[0] : req.params.taskId;
  res.json({ history: await listTaskHistory(taskId) });
});

app.get('/api/v1/owner/audit', requireOwner, async (_req: Request, res: Response) => {
  res.json({ records: await listAuditRecords() });
});

app.get('/api/v1/owner/secret-bus/status', requireOwner, (_req: Request, res: Response) => {
  res.json({ status: secretBus.status() });
});

app.get('/api/v1/owner/secrets', requireOwner, (req: Request, res: Response) => {
  res.json({ records: secretBus.list(res.locals.owner.subject) });
});

app.get('/api/v1/owner/secrets/:id', requireOwner, (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const record = secretBus.get(res.locals.owner.subject, id);
  if (!record) { res.status(404).json({ error: 'Secret record not found' }); return; }
  res.json({ record });
});

app.post('/api/v1/owner/secrets', requireOwner, (req: Request, res: Response) => {
  if (typeof req.body?.label !== 'string' || typeof req.body?.value !== 'string' || typeof req.body?.type !== 'string') { res.status(400).json({ error: 'type, label, and value are required' }); return; }
  try {
    const record = secretBus.create({ ownerId: res.locals.owner.subject, type: req.body.type as SecretType, label: req.body.label, value: req.body.value, tags: req.body.tags, projectReference: req.body.projectReference });
    res.status(201).json({ record });
  } catch { res.status(503).json({ error: 'KC Secret Bus is unavailable; configure its encryption key' }); }
});

app.post('/api/v1/owner/secrets/:id/reveal', requireOwner, requireStepUp, (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    const value = secretBus.reveal(res.locals.owner.subject, id);
    if (value === undefined) { res.status(404).json({ error: 'Secret record not found' }); return; }
    res.json({ value });
  } catch { res.status(503).json({ error: 'KC Secret Bus is unavailable' }); }
});

app.patch('/api/v1/owner/secrets/:id', requireOwner, (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    const record = secretBus.update(res.locals.owner.subject, id, { label: req.body?.label, value: req.body?.value, tags: req.body?.tags, projectReference: req.body?.projectReference });
    if (!record) { res.status(404).json({ error: 'Secret record not found' }); return; }
    res.json({ record });
  } catch { res.status(503).json({ error: 'KC Secret Bus is unavailable' }); }
});

app.delete('/api/v1/owner/secrets/:id', requireOwner, requireStepUp, (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!secretBus.delete(res.locals.owner.subject, id)) { res.status(404).json({ error: 'Secret record not found' }); return; }
  res.status(204).send();
});

app.get('/api/v1/info', (_req: Request, res: Response) => {
  res.json({
    service: 'kc-ai',
    description: 'Central AI assistant for the KC ecosystem',
    supportedApps: ['KC TELECOM', 'KC Earn', 'KC Messaging Africa', 'KC Business Suite'],
    welcomeEnabled: env.KC_AI_ENABLE_WELCOME,
    voiceEnabled: env.KC_AI_ENABLE_VOICE,
    ttsProvider: env.KC_AI_TTS_PROVIDER,
    capabilities: listCapabilities(),
    ownerAuthentication: authConfigurationStatus(),
  });
});

if (require.main === module) app.listen(port, () => console.log(`KC AI service listening on port ${port}`));

export default app;
