export interface OwnerWorkingProfile {
  ownerId: string;
  displayName?: string;
  preferences: Record<string, string>;
  workingContext: string[];
  authorizationNotes: string[];
  createdAt: string;
  updatedAt: string;
}