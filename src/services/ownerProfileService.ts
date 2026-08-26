import { getStorage } from './storage';
import type { OwnerWorkingProfile } from '../types/ownerProfile';

function emptyProfile(ownerId: string): OwnerWorkingProfile {
  const now = new Date().toISOString();
  return { ownerId, preferences: {}, workingContext: [], authorizationNotes: [], createdAt: now, updatedAt: now };
}

export async function loadOwnerProfile(ownerId: string): Promise<OwnerWorkingProfile> {
  return (await getStorage().getOwnerProfile(ownerId)) || emptyProfile(ownerId);
}

export async function updateOwnerProfile(input: { ownerId: string; displayName?: string; preferences?: Record<string, string>; workingContext?: string[]; authorizationNotes?: string[] }): Promise<OwnerWorkingProfile> {
  const current = await loadOwnerProfile(input.ownerId);
  const profile: OwnerWorkingProfile = {
    ...current,
    displayName: input.displayName?.trim() || current.displayName,
    preferences: input.preferences ? { ...current.preferences, ...input.preferences } : current.preferences,
    workingContext: input.workingContext ? [...new Set(input.workingContext.map((value) => value.trim()).filter(Boolean))] : current.workingContext,
    authorizationNotes: input.authorizationNotes ? [...new Set(input.authorizationNotes.map((value) => value.trim()).filter(Boolean))] : current.authorizationNotes,
    updatedAt: new Date().toISOString(),
  };
  return getStorage().saveOwnerProfile(profile);
}