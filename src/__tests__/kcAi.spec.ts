import { describe, expect, it } from 'vitest';
import { createHealthResponse } from '../services/healthService';
import { createWelcomeMessage } from '../services/welcomeService';

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
});
