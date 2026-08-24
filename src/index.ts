import express, { type Request, type Response } from 'express';
import { env, allowedOrigins } from './config/env';
import { createHealthResponse } from './services/healthService';
import { createWelcomeMessage } from './services/welcomeService';
import { createSessionRecord } from './services/sessionService';
import { generateChatReply, ChatRequestSchema } from './services/chatService';
import { createTtsResponse } from './services/ttsService';
import { listCapabilities } from './services/capabilityService';
import { createAndAdvanceTask, getTask } from './services/taskService';
import { listAuditRecords } from './services/auditService';
import { verifyOwnerToken } from './services/ownerModeService';
import { SecretBus } from './services/secretBusService';

const app = express();
const port = env.KC_AI_PORT;
const secretBus = new SecretBus(env.KC_AI_SECRET_BUS_KEY);

function ownerClaims(req: Request) {
  const authorization = req.headers.authorization;
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
  return verifyOwnerToken(token, env.KC_AI_JWT_SECRET);
}

app.use(express.json());

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }

  next();
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

app.post('/api/v1/chat', (req: Request, res: Response) => {
  const parsed = ChatRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid chat payload',
      details: parsed.error.flatten(),
    });
    return;
  }

  const response = generateChatReply(parsed.data);
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

app.get('/api/v1/capabilities', (_req: Request, res: Response) => {
  res.json({ capabilities: listCapabilities() });
});

app.post('/api/v1/tasks', (req: Request, res: Response) => {
  if (typeof req.body?.goal !== 'string' || req.body.goal.trim().length === 0) {
    res.status(400).json({ error: 'A non-empty goal is required' });
    return;
  }

  const task = createAndAdvanceTask({
    goal: req.body.goal,
    appId: req.body.appId,
    appName: req.body.appName,
    actorRole: ownerClaims(req) ? 'owner' : 'user',
  });
  res.status(task.status === 'blocked' ? 409 : 201).json({ task });
});

app.get('/api/v1/tasks/:taskId', (req: Request, res: Response) => {
  const taskId = Array.isArray(req.params.taskId) ? req.params.taskId[0] : req.params.taskId;
  const task = getTask(taskId);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json({ task });
});

app.get('/api/v1/owner/audit', (req: Request, res: Response) => {
  if (!ownerClaims(req)) {
    res.status(401).json({ error: 'Authenticated Owner Mode is required' });
    return;
  }
  res.json({ records: listAuditRecords() });
});

app.get('/api/v1/owner/secret-bus/status', (req: Request, res: Response) => {
  if (!ownerClaims(req)) {
    res.status(401).json({ error: 'Authenticated Owner Mode is required' });
    return;
  }
  res.json({ status: secretBus.status() });
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
  });
});

app.listen(port, () => {
  console.log(`KC AI service listening on port ${port}`);
});
