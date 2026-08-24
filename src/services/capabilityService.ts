import type { CapabilityStatus } from '../types/task';

export interface Capability {
  id: string;
  description: string;
  status: CapabilityStatus;
  requiresOwner?: boolean;
  reason?: string;
}

const capabilities: Capability[] = [
  { id: 'chat.reply', description: 'Generate a contextual KC AI chat reply', status: 'available' },
  { id: 'welcome.generate', description: 'Generate the post-authentication welcome payload', status: 'available' },
  { id: 'tts.browser-payload', description: 'Prepare a browser TTS payload', status: 'available' },
  { id: 'task.orchestration', description: 'Create and advance task state', status: 'available' },
  { id: 'private-build', description: 'Owner-only private development and staging lifecycle', status: 'available', requiresOwner: true },
  { id: 'owner-wallet-foundation', description: 'Owner-only private ledger foundation; no live money movement', status: 'available', requiresOwner: true },
  { id: 'owner-health-watch', description: 'Owner-only health checks for registered KC product integrations', status: 'available', requiresOwner: true },
  { id: 'kc-secret-bus', description: 'Encrypted owner-only secret storage', status: 'credentials-required', requiresOwner: true, reason: 'KC_AI_SECRET_BUS_KEY is not configured' },
  { id: 'kc-product-data', description: 'Read or update data in connected KC products', status: 'external-integration-required', reason: 'No KC product integration is configured' },
  { id: 'deployment', description: 'Deploy software to an external environment', status: 'planned', reason: 'No deployment integration is implemented' },
  { id: 'payments', description: 'Initiate or complete payments', status: 'planned', reason: 'No payment integration is implemented' },
];

export function listCapabilities(): Capability[] {
  return capabilities.map((capability) => ({ ...capability }));
}

export function getCapability(id: string): Capability | undefined {
  const capability = capabilities.find((entry) => entry.id === id);
  return capability ? { ...capability } : undefined;
}

export function checkCapability(id: string): Capability {
  return getCapability(id) ?? {
    id,
    description: 'Unknown capability',
    status: 'planned',
    reason: 'This capability is not registered',
  };
}
