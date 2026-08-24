import { describe, expect, it } from 'vitest';
import { createHealthResponse } from '../services/healthService';
import { createWelcomeMessage } from '../services/welcomeService';
import { checkCapability } from '../services/capabilityService';
import { createAndAdvanceTask } from '../services/taskService';
import { getTask, reloadTasks } from '../services/taskService';
import { SecretBus } from '../services/secretBusService';
import { verifyOwnerToken } from '../services/ownerModeService';
import { authenticateOwner, hashPassword, issueStepUpToken, logoutOwner, verifyOwnerSession, verifyStepUpToken } from '../services/authService';
import { clearAuditRecords, listAuditRecords, recordAudit } from '../services/auditService';
import { createHmac } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';

describe('KC AI foundation', () => {
  it('creates a health response with status and service metadata', () => {
    const response = createHealthResponse();

    expect(response.status).toBe('ok');
    expect(response.service).toBe('kc-ai');
    expect(response.version).toBeDefined();
  });

  it('creates a mandatory welcome for signup/login that is central to the KC ecosystem', () => {
    const welcome = createWelcomeMessage({
      userName: 'Jane',
      appId: 'kc-telecom',
      appName: 'KC TELECOM',
      ecosystem: ['KC TELECOM', 'KC Earn', 'KC Messaging Africa', 'KC Business Suite'],
    });

    expect(welcome.mandatory).toBe(true);
    expect(welcome.trigger).toBe('after-auth-success');
    expect(welcome.autoPlayPolicy).toBe('start-immediately-after-first-user-interaction-if-browser-blocks-audio');
    expect(welcome.voice).toContain('Hello Jane');
    expect(welcome.text).toContain('central assistant for the KC ecosystem');
    expect(welcome.text).toContain('KC TELECOM');
    expect(welcome.text).toContain('KC Earn');
    expect(welcome.permissionsHint).toContain('browser or device audio permissions');
    expect(welcome.permissionsHint).not.toContain('Skip');
    expect(welcome.permissionsHint).not.toContain('Mute');
    expect(welcome.permissionsHint).not.toContain('Disable KC AI Voice');
    expect(welcome.permissionsHint).not.toContain('Never play again');
    expect(welcome.voiceControls).toBe('normal KC AI conversation voice controls remain separate from mandatory login/signup introduction');
  });

  it('blocks unsupported external work instead of claiming success', () => {
    expect(checkCapability('deployment').status).toBe('planned');

    const task = createAndAdvanceTask({ goal: 'deploy this to production', appId: 'kc-telecom' });

    expect(task.status).toBe('blocked');
    expect(task.verificationStatus).toBe('not-verified');
    expect(task.blockedReason).toContain('deployment integration');
  });

  it('encrypts Secret Bus values and reports missing key material', () => {
    const unavailable = new SecretBus();
    expect(unavailable.status().available).toBe(false);

    const bus = new SecretBus('a'.repeat(32), '/tmp/kc-ai-test-secrets.json');
    const metadata = bus.create({ ownerId: 'owner-1', type: 'private-note', label: 'Example', value: 'test-only-value' });
    expect(metadata.maskedValue).not.toContain('test-only-value');
    expect(bus.reveal('owner-1', metadata.id)).toBe('test-only-value');
  });

  it('persists encrypted vault metadata without plaintext and reloads records', () => {
    const filePath = '/tmp/kc-ai-persistent-secrets.json';
    try { unlinkSync(filePath); } catch {}
    const first = new SecretBus('b'.repeat(32), filePath);
    const created = first.create({ ownerId: 'owner-2', type: 'api-key', label: 'Build key', value: 'private-test-value' });
    const raw = readFileSync(filePath, 'utf8');
    expect(raw).not.toContain('private-test-value');
    const second = new SecretBus('b'.repeat(32), filePath);
    expect(second.list('owner-2')).toHaveLength(1);
    expect(second.get('other-owner', created.id)).toBeUndefined();
    expect(second.reveal('owner-2', created.id)).toBe('private-test-value');
    unlinkSync(filePath);
  });

  it('issues, expires, re-authenticates, and revokes owner sessions', () => {
    process.env.KC_AI_OWNER_ID = 'test-owner';
    process.env.KC_AI_OWNER_PASSWORD_HASH = hashPassword('correct horse battery staple');
    const secret = 'owner-session-test-secret';
    const result = authenticateOwner({ ownerId: 'test-owner', password: 'correct horse battery staple', secret });
    expect(result).toBeDefined();
    expect(verifyOwnerSession(result?.sessionToken, secret)).toBeDefined();
    expect(verifyOwnerSession(result?.sessionToken, secret, result?.expiresAt)).toBeUndefined();
    const stepUp = issueStepUpToken({ token: result?.sessionToken, password: 'correct horse battery staple', secret });
    expect(verifyStepUpToken(stepUp)).toBe(true);
    expect(logoutOwner(result?.sessionToken, secret)).toBe(true);
    expect(verifyOwnerSession(result?.sessionToken, secret)).toBeUndefined();
  });

  it('records safe audit errors without sensitive values', () => {
    clearAuditRecords();
    recordAudit({ actionType: 'test', actorRole: 'owner', outcome: 'failed', verificationStatus: 'not-verified', error: 'token=do-not-log password=also-private' });
    const audit = listAuditRecords();
    expect(audit[0].error).toBe('token=[REDACTED] password=[REDACTED]');
  });

  it('reloads task state from the atomic local store', () => {
    const task = createAndAdvanceTask({ goal: 'prepare a safe local checklist' });
    expect(getTask(task.taskId)).toBeDefined();
    reloadTasks();
    expect(getTask(task.taskId)).toMatchObject({ taskId: task.taskId, status: 'completed', lastSuccessfulStep: expect.any(String) });
  });

  it('accepts only signed, unexpired Owner Mode claims', () => {
    const secret = 'owner-auth-test-secret';
    const claims = Buffer.from(JSON.stringify({ subject: 'owner-1', role: 'owner', expiresAt: Date.now() + 60_000 })).toString('base64url');
    const signature = createHmac('sha256', secret).update(claims).digest('base64url');

    expect(verifyOwnerToken(`${claims}.${signature}`, secret)).toMatchObject({ subject: 'owner-1', role: 'owner' });
    expect(verifyOwnerToken(`${claims}.invalid`, secret)).toBeUndefined();
  });
});
