import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { createHealthResponse } from '../services/healthService';
import { verifyOwnerToken } from '../services/ownerModeService';
import { authConfigurationStatus, authenticateOwner, hashPassword, initializeOwner, issueStepUpToken, verifyOwnerSession } from '../services/authService';
import { createAndAdvanceTask } from '../services/taskService';
import { clearAuditRecords, listAuditRecords } from '../services/auditService';
import { createPrivateBuild, getPrivateBuild } from '../services/privateBuildService';
import { SecretBus } from '../services/secretBusService';
import { verifySystem } from '../services/systemVerificationService';
import { readFileSync } from 'node:fs';

function signedOwnerClaim(secret: string, subject = 'acceptance-owner'): string {
  const claims = Buffer.from(JSON.stringify({ subject, role: 'owner', expiresAt: Date.now() + 60_000 })).toString('base64url');
  return `${claims}.${createHmac('sha256', secret).update(claims).digest('base64url')}`;
}

describe('KC AI owner acceptance', () => {
  it('allows only a verified owner claim into Owner Mode', () => {
    const secret = 'acceptance-owner-secret';
    expect(verifyOwnerToken(signedOwnerClaim(secret), secret)).toMatchObject({ role: 'owner', subject: 'acceptance-owner' });
    expect(verifyOwnerToken(signedOwnerClaim(secret, 'ordinary-user'), 'wrong-secret')).toBeUndefined();
    expect(verifyOwnerToken(undefined, secret)).toBeUndefined();
  });

  it('returns a readiness result from actual health, capability, storage, and Secret Bus checks', async () => {
    const result = await verifySystem('test', new SecretBus());
    expect(['READY', 'PARTIALLY AVAILABLE', 'UNAVAILABLE']).toContain(result.status);
    expect(result.checks.health).toBe('PASS');
    expect(result.checks.storage).toBe('AVAILABLE');
    expect(result.checks.capabilities).toBe('PARTIALLY AVAILABLE');
    expect(result.checks.secretBus).toBe('UNAVAILABLE');
    expect(result.status).toBe('PARTIALLY AVAILABLE');
  });

  it('executes and validates a harmless task before completion and preserves audit evidence', async () => {
    await clearAuditRecords();
    const task = await createAndAdvanceTask({ goal: 'prepare a harmless owner acceptance checklist', actorRole: 'owner' });
    expect(task.status).toBe('completed');
    expect(task.verificationStatus).toBe('verified');
    expect(task.result).toBeTruthy();
    expect(task.verificationResult).toBeTruthy();
    expect((await listAuditRecords()).filter((record) => record.taskId === task.taskId).map((record) => record.actionType)).toEqual(['task.received', 'task.completed']);
  });

  it('requires a verified owner and step-up for private build access', async () => {
    process.env.KC_AI_OWNER_ID = 'acceptance-owner';
    process.env.KC_AI_OWNER_PASSWORD_HASH = hashPassword('acceptance owner password');
    const secret = 'acceptance-auth-secret';
    const login = await authenticateOwner({ ownerId: 'acceptance-owner', password: 'acceptance owner password', secret });
    expect(login).toBeDefined();
    expect(verifyOwnerSession(login?.sessionToken, secret)).toBeDefined();
    const stepUp = await issueStepUpToken({ token: login?.sessionToken, password: 'acceptance owner password', secret });
    expect(stepUp).toBeDefined();
    const build = await createPrivateBuild({ ownerId: 'acceptance-owner', goal: 'Acceptance-only private build check' });
    expect(getPrivateBuild(build.privateBuildId, 'ordinary-user')).toBeUndefined();
    expect(getPrivateBuild(build.privateBuildId, 'acceptance-owner')).toMatchObject({ status: 'PRIVATE_BUILD' });
  });

  it('keeps Secret Bus values private and unsupported capabilities blocked', async () => {
    const bus = new SecretBus('c'.repeat(32), '/tmp/kc-ai-acceptance-secrets.json');
    const metadata = bus.create({ ownerId: 'acceptance-owner', type: 'private-note', label: 'Acceptance secret', value: 'do-not-expose' });
    expect(metadata.maskedValue).not.toContain('do-not-expose');
    expect(bus.get('ordinary-user', metadata.id)).toBeUndefined();
    const blocked = await createAndAdvanceTask({ goal: 'deploy to production', actorRole: 'user' });
    expect(blocked.status).toBe('blocked');
    expect(blocked.verificationStatus).toBe('not-verified');
  });

  it('confirms the current source commit without claiming deployment evidence', () => {
    expect(createHealthResponse('test')).toMatchObject({ status: 'ok', service: 'kc-ai' });
  });

  it('keeps the owner hash tool local and owner-only', () => {
    const html = readFileSync('public/index.html', 'utf8');
    const app = readFileSync('public/app.js', 'utf8');
    const hashTool = readFileSync('public/owner-password-hash.js', 'utf8');
    expect(html).toContain('class="tab owner-only" data-view="password-hash"');
    expect(app).toContain("if(view==='password-hash'&&!state.token){show('signin');return}");
    expect(hashTool).not.toMatch(/fetch|XMLHttpRequest|localStorage|sessionStorage|console\.|document\.cookie/);
    expect(app).toContain("$('hash-password').value='';$('hash-password-confirm').value=''");
    expect(app).not.toMatch(/api\([^\n]*hash-password|JSON\.stringify\([^\n]*hash-password/);
    expect(app).toContain('body:JSON.stringify({setupSecret,passwordHash})');
    expect(app).not.toContain('body:JSON.stringify({setupSecret,password})');
  });

  it('cannot initialize after owner authentication has been configured', () => {
    process.env.KC_AI_OWNER_PASSWORD_HASH = hashPassword('configured owner password');
    process.env.KC_AI_OWNER_INITIALIZATION_SECRET = 'i'.repeat(32);
    expect(initializeOwner({ setupSecret: 'i'.repeat(32), passwordHash: hashPassword('new owner password') })).toBe(false);
    expect(authConfigurationStatus()).toMatchObject({ configured: true, initializationAvailable: false, mode: 'environment-hash' });
  });

  it('keeps the owner password hash out of the Railway build command', () => {
    const railwayConfig = readFileSync('railway.toml', 'utf8');
    expect(railwayConfig).toContain('buildCommand = "npm run build"');
    expect(railwayConfig).toContain('startCommand = "npm start"');
    expect(railwayConfig).not.toContain('KC_AI_OWNER_PASSWORD_HASH');
  });
});
