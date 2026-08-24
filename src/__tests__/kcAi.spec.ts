import { describe, expect, it } from 'vitest';
import { createHealthResponse } from '../services/healthService';
import { createWelcomeMessage } from '../services/welcomeService';
import { checkCapability } from '../services/capabilityService';
import { createAndAdvanceTask } from '../services/taskService';
import { SecretBus } from '../services/secretBusService';
import { verifyOwnerToken } from '../services/ownerModeService';
import { createHmac } from 'node:crypto';

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

    const bus = new SecretBus('a'.repeat(32));
    bus.set('example', 'test-only-value');
    expect(bus.has('example')).toBe(true);
    expect(bus.reveal('example')).toBe('test-only-value');
  });

  it('accepts only signed, unexpired Owner Mode claims', () => {
    const secret = 'owner-auth-test-secret';
    const claims = Buffer.from(JSON.stringify({ subject: 'owner-1', role: 'owner', expiresAt: Date.now() + 60_000 })).toString('base64url');
    const signature = createHmac('sha256', secret).update(claims).digest('base64url');

    expect(verifyOwnerToken(`${claims}.${signature}`, secret)).toMatchObject({ subject: 'owner-1', role: 'owner' });
    expect(verifyOwnerToken(`${claims}.invalid`, secret)).toBeUndefined();
  });
});
