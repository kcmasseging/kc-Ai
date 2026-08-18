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
}

export function createWelcomeMessage(input: WelcomeInput = {}): WelcomeMessage {
  const userName = input.userName?.trim() || 'there';
  const appName = input.appName || 'this KC application';
  const appId = input.appId || 'unknown-app';
  const ecosystem = input.ecosystem && input.ecosystem.length > 0
    ? input.ecosystem
    : ['KC TELECOM', 'KC Earn', 'KC Messaging Africa', 'KC Business Suite'];

  const text = [
    `Hello ${userName}, I am KC AI, your central assistant for the KC ecosystem.`,
    `I can help you in ${appName} and across the broader KC ecosystem, including ${ecosystem.join(', ')}.`,
    'If browser audio is enabled and you approve microphone or sound permissions, I can speak to you with a clear voice greeting and explain the services available to you.',
    'I am designed as a reusable KC AI service, so each KC product can connect to the same assistant while keeping the app-specific context visible and secure.'
  ].join(' ');

  const voice = `Hello ${userName}, I am KC AI. Welcome to ${appName}. I help you across the KC ecosystem, including ${ecosystem.join(', ')}.`;

  return {
    text,
    voice,
    permissionsHint: 'Use browser audio permission controls to allow KC AI to speak. You can always mute or disable voice at any time.',
    appContext: {
      appId,
      appName,
    },
  };
}
