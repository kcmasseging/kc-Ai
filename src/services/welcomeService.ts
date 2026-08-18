export interface WelcomeInput {
  userName?: string;
  appId?: string;
  appName?: string;
  ecosystem?: string[];
}

export interface WelcomeMessage {
  text: string;
  voice: string;
  permissionsHint: string;
  appContext: {
    appId?: string;
    appName?: string;
  };
  mandatory: boolean;
  trigger: 'after-auth-success';
  autoPlayPolicy: 'start-immediately-after-first-user-interaction-if-browser-blocks-audio';
  voiceControls: 'normal KC AI conversation voice controls remain separate from mandatory login/signup introduction';
}

export function createWelcomeMessage(input: WelcomeInput = {}): WelcomeMessage {
  const userName = input.userName?.trim() || 'there';
  const appName = input.appName || 'this KC application';
  const appId = input.appId || 'unknown-app';
  const ecosystem = input.ecosystem && input.ecosystem.length > 0
    ? input.ecosystem
    : ['KC TELECOM', 'KC Earn', 'KC Messaging Africa', 'KC Business Suite'];

  const text = [
    `Hello ${userName}, I am KC AI, the central assistant for the KC ecosystem.`,
    `After successful login or signup in ${appName}, I will automatically introduce myself and explain the relevant KC services while recognizing the current application context.`,
    `I can help you in ${appName} and across the broader KC ecosystem, including ${ecosystem.join(', ')}.`,
    'This mandatory welcome follows browser and operating-system audio security restrictions. If audio is initially blocked, I start immediately after the first permitted user interaction.',
    'I am designed as a reusable KC AI service, so each KC product can connect to the same assistant while keeping the app-specific context visible and secure.'
  ].join(' ');

  const voice = `Hello ${userName}, I am KC AI, the central assistant for the entire KC ecosystem. Welcome to ${appName}. I help you across KC TELECOM, KC Earn, KC Messaging Africa, KC Business Suite, and the broader KC ecosystem.`;

  return {
    text,
    voice,
    permissionsHint: 'KC AI must play this mandatory introduction after signup or login when browser or device audio permissions allow. If the browser blocks audio initially, KC AI starts immediately after the first permitted user interaction. This introduction is required and separate from normal KC AI conversation voice controls.',
    appContext: {
      appId,
      appName,
    },
    mandatory: true,
    trigger: 'after-auth-success',
    autoPlayPolicy: 'start-immediately-after-first-user-interaction-if-browser-blocks-audio',
    voiceControls: 'normal KC AI conversation voice controls remain separate from mandatory login/signup introduction',
  };
}
