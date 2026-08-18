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

  it('creates an introduction message for a KC application with ecosystem context', () => {
    const welcome = createWelcomeMessage({
      userName: 'Jane',
      appId: 'kc-telecom',
      appName: 'KC TELECOM',
      ecosystem: ['KC TELECOM', 'KC Earn', 'KC Messaging Africa', 'KC Business Suite'],
    });

    expect(welcome.voice).toContain('Hello Jane');
    expect(welcome.text).toContain('KC TELECOM');
    expect(welcome.text).toContain('KC Earn');
    expect(welcome.text).toContain('KC ecosystem');
    expect(welcome.permissionsHint).toContain('audio permission');
  });
});
