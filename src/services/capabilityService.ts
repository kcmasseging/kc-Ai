import type { CapabilityStatus } from '../types/task';
import { getWebSearchConfiguration } from './webSearchService';

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
  { id: 'internal.reasoning', description: 'Perform safe internal reasoning and task analysis', status: 'available' },
  { id: 'internal.analysis', description: 'Analyze information already supplied to KC AI', status: 'available' },
  { id: 'private-build', description: 'Owner-only private development and staging lifecycle', status: 'available', requiresOwner: true },
  { id: 'owner-wallet-foundation', description: 'Owner-only private ledger foundation; no live money movement', status: 'available', requiresOwner: true },
  { id: 'owner-health-watch', description: 'Owner-only health checks for registered KC product integrations', status: 'available', requiresOwner: true },
  { id: 'kc-secret-bus', description: 'Encrypted owner-only secret storage', status: 'credentials-required', requiresOwner: true, reason: 'KC_AI_SECRET_BUS_KEY is not configured' },
  { id: 'kc-product-data', description: 'Read or update data in connected KC products', status: 'external-integration-required', reason: 'No KC product integration is configured' },
  { id: 'email.send', description: 'Send email through an external email provider', status: 'planned', reason: 'No email provider integration is implemented' },
  { id: 'message.send', description: 'Send messages through an external messaging provider', status: 'planned', reason: 'No external messaging integration is implemented' },
  { id: 'external-message.send', description: 'Send messages through an external messaging provider', status: 'planned', reason: 'No external messaging integration is implemented' },
  { id: 'deployment', description: 'Deploy software to an external environment', status: 'planned', reason: 'No deployment integration is implemented' },
  { id: 'deployment.execute', description: 'Deploy software to an external environment', status: 'planned', reason: 'No deployment integration is implemented' },
  { id: 'payments', description: 'Initiate or complete payments', status: 'planned', reason: 'No payment integration is implemented' },
  { id: 'payment.transfer', description: 'Initiate or complete payments', status: 'planned', reason: 'No payment integration is implemented' },
  { id: 'account.changes', description: 'Change an account or external service setting', status: 'planned', reason: 'No account-management integration is implemented' },
  { id: 'file.deletion', description: 'Delete files in an external or persistent system', status: 'planned', reason: 'No file-deletion integration is implemented' },
  { id: 'file.delete', description: 'Delete files in an external or persistent system', status: 'planned', reason: 'No file-deletion integration is implemented' },
  { id: 'external-api.action', description: 'Perform an action through an external API', status: 'planned', reason: 'No external API integration is implemented' },
  { id: 'browser.action', description: 'Perform an action in an external browser session', status: 'planned', reason: 'No browser action integration is implemented' },
  { id: 'owner.private-build', description: 'Owner-only private development and staging lifecycle', status: 'available', requiresOwner: true },
];

export function listCapabilities(): Capability[] {
  return capabilities.map((capability) => capability.id === 'web.search' ? webSearchCapability() : ({ ...capability }));
}

export function getCapability(id: string): Capability | undefined {
  if (id === 'web.search') return webSearchCapability();
  const capability = capabilities.find((entry) => entry.id === id);
  return capability ? { ...capability } : undefined;
}

export function checkCapability(id: string): Capability {
  if (id === 'web.search') return webSearchCapability();
  return getCapability(id) ?? {
    id,
    description: 'Unknown capability',
    status: 'planned',
    reason: 'This capability is not registered',
  };
}

function webSearchCapability(): Capability {
  const configuration = getWebSearchConfiguration();
  return configuration.configured
    ? { id: 'web.search', description: 'Search the web through an external provider', status: 'available', reason: 'Configured provider credentials are present; availability is confirmed per search response' }
    : { id: 'web.search', description: 'Search the web through an external provider', status: 'credentials-required', reason: configuration.reason };
}
