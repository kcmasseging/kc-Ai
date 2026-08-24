import { createHealthResponse } from './healthService';
import { listCapabilities } from './capabilityService';
import { getStorage } from './storage';
import { SecretBus } from './secretBusService';

export type SystemVerificationStatus = 'READY' | 'PARTIALLY AVAILABLE' | 'UNAVAILABLE';

export interface SystemVerificationResult {
  status: SystemVerificationStatus;
  checks: {
    health: 'PASS' | 'FAIL';
    storage: 'AVAILABLE' | 'UNAVAILABLE';
    capabilities: 'AVAILABLE' | 'PARTIALLY AVAILABLE';
    secretBus: 'AVAILABLE' | 'UNAVAILABLE';
  };
}

export async function verifySystem(environment: string, secretBus: SecretBus): Promise<SystemVerificationResult> {
  const health = createHealthResponse(environment).status === 'ok';
  let storageAvailable = true;
  try { await getStorage().listTasks(); } catch { storageAvailable = false; }
  const capabilities = listCapabilities();
  const capabilitiesAvailable = capabilities.some((capability) => capability.status === 'available');
  const allCapabilitiesAvailable = capabilities.every((capability) => capability.status === 'available');
  const secretAvailable = secretBus.status().available;
  const checks = {
    health: health ? 'PASS' as const : 'FAIL' as const,
    storage: storageAvailable ? 'AVAILABLE' as const : 'UNAVAILABLE' as const,
    capabilities: allCapabilitiesAvailable ? 'AVAILABLE' as const : capabilitiesAvailable ? 'PARTIALLY AVAILABLE' as const : 'PARTIALLY AVAILABLE' as const,
    secretBus: secretAvailable ? 'AVAILABLE' as const : 'UNAVAILABLE' as const,
  };
  const availableChecks = [health, storageAvailable, capabilitiesAvailable, secretAvailable].filter(Boolean).length;
  return { status: availableChecks === 4 ? 'READY' : availableChecks > 0 ? 'PARTIALLY AVAILABLE' : 'UNAVAILABLE', checks };
}
