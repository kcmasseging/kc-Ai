import { createHmac, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../index';
import { env } from '../config/env';
import { authenticateOwner, hashPassword } from '../services/authService';
import { createAndAdvanceTask } from '../services/taskService';

type ResponseBody = Record<string, unknown>;

let server: Server;
let baseUrl: string;
let ownerToken: string;
let protectedTaskId: string;

async function request(path: string, options: RequestInit = {}): Promise<{ status: number; body: ResponseBody }> {
  const response = await fetch(`${baseUrl}${path}`, options);
  return { status: response.status, body: await response.json().catch(() => ({})) as ResponseBody };
}

function bearer(token: string): RequestInit {
  return { headers: { Authorization: `Bearer ${token}` } };
}

function signedOwnerToken(subject: string): string {
  const claims = Buffer.from(JSON.stringify({ subject, role: 'owner', issuedAt: Date.now(), expiresAt: Date.now() + 60_000, sessionId: randomBytes(18).toString('hex') })).toString('base64url');
  return `${claims}.${createHmac('sha256', env.KC_AI_JWT_SECRET).update(claims).digest('base64url')}`;
}

describe('KC Robot owner security', () => {
  beforeAll(async () => {
    process.env.KC_AI_OWNER_ID = 'stage1-owner';
    process.env.KC_AI_OWNER_PASSWORD_HASH = hashPassword('stage1-owner-password');
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not start');
    baseUrl = `http://127.0.0.1:${address.port}`;
    const login = await request('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ownerId: 'stage1-owner', password: 'stage1-owner-password' }) });
    expect(login.status).toBe(200);
    ownerToken = login.body.sessionToken as string;
    const task = await createAndAdvanceTask({ ownerId: 'stage1-owner', goal: 'stage 1 protected task' });
    protectedTaskId = task.taskId;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it('rejects anonymous chat and task operations', async () => {
    expect((await request('/api/v1/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'hello' }) })).status).toBe(401);
    expect((await request('/api/v1/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goal: 'anonymous task' }) })).status).toBe(401);
    expect((await request('/api/v1/tasks')).status).toBe(401);
    expect((await request(`/api/v1/tasks/${protectedTaskId}`)).status).toBe(401);
    expect((await request(`/api/v1/tasks/${protectedTaskId}/history`)).status).toBe(401);
  });

  it('rejects anonymous private owner resources', async () => {
    expect((await request('/api/v1/owner/profile')).status).toBe(401);
    expect((await request('/api/v1/owner/project-intents/private-test')).status).toBe(401);
    expect((await request('/api/v1/owner/secrets')).status).toBe(401);
    expect((await request('/api/v1/owner/secret-bus/status')).status).toBe(401);
  });

  it('allows the authenticated owner path and scopes task IDs', async () => {
    expect((await request('/api/v1/chat', { ...bearer(ownerToken), method: 'POST', headers: { ...bearer(ownerToken).headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'hello' }) })).status).toBe(200);
    expect((await request('/api/v1/tasks', bearer(ownerToken))).status).toBe(200);
    expect((await request(`/api/v1/tasks/${protectedTaskId}`, bearer(ownerToken))).status).toBe(200);
    expect((await request(`/api/v1/tasks/${protectedTaskId}/history`, bearer(ownerToken))).status).toBe(200);
    expect((await request(`/api/v1/tasks/${protectedTaskId}`, bearer(signedOwnerToken('different-owner')))).status).toBe(404);
  });
});
