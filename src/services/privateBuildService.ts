import { randomUUID } from 'node:crypto';
import { recordAudit } from './auditService';

export type PrivateBuildStatus =
  | 'PRIVATE_BUILD'
  | 'VALIDATED'
  | 'OWNER_REVIEW_REQUIRED'
  | 'APPROVED_FOR_STAGING'
  | 'APPROVED_FOR_PRODUCTION';

export interface PrivateBuildRecord {
  privateBuildId: string;
  ownerId: string;
  goal: string;
  status: PrivateBuildStatus;
  createdAt: string;
  updatedAt: string;
  privateContext: 'development-staging';
  productionActivation: 'disabled';
}

const builds = new Map<string, PrivateBuildRecord>();

const transitions: Record<PrivateBuildStatus, PrivateBuildStatus | undefined> = {
  PRIVATE_BUILD: 'VALIDATED',
  VALIDATED: 'OWNER_REVIEW_REQUIRED',
  OWNER_REVIEW_REQUIRED: 'APPROVED_FOR_STAGING',
  APPROVED_FOR_STAGING: 'APPROVED_FOR_PRODUCTION',
  APPROVED_FOR_PRODUCTION: undefined,
};

export function createPrivateBuild(input: { ownerId: string; goal: string; now?: string }): PrivateBuildRecord {
  const now = input.now ?? new Date().toISOString();
  const build: PrivateBuildRecord = {
    privateBuildId: `build_${randomUUID()}`,
    ownerId: input.ownerId,
    goal: input.goal.trim(),
    status: 'PRIVATE_BUILD',
    createdAt: now,
    updatedAt: now,
    privateContext: 'development-staging',
    productionActivation: 'disabled',
  };
  builds.set(build.privateBuildId, build);
  recordAudit({ actionType: 'private-build.created', actorRole: 'owner', outcome: 'started', verificationStatus: 'verified' });
  return { ...build };
}

export function getPrivateBuild(privateBuildId: string, ownerId: string): PrivateBuildRecord | undefined {
  const build = builds.get(privateBuildId);
  return build?.ownerId === ownerId ? { ...build } : undefined;
}

export function advancePrivateBuild(privateBuildId: string, ownerId: string, target: PrivateBuildStatus): PrivateBuildRecord | undefined {
  const build = builds.get(privateBuildId);
  if (!build || build.ownerId !== ownerId || transitions[build.status] !== target) return undefined;

  build.status = target;
  build.updatedAt = new Date().toISOString();
  recordAudit({ actionType: `private-build.${target.toLowerCase()}`, actorRole: 'owner', outcome: 'completed', verificationStatus: 'verified' });
  return { ...build };
}
