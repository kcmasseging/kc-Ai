export interface SessionRecord {
  sessionId: string;
  userId?: string;
  appId?: string;
  appName?: string;
  createdAt: string;
  updatedAt: string;
  greetingShown: boolean;
}

export function createSessionRecord(input: Partial<SessionRecord> = {}): SessionRecord {
  const now = new Date().toISOString();

  return {
    sessionId: input.sessionId || `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: input.userId,
    appId: input.appId,
    appName: input.appName,
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
    greetingShown: input.greetingShown ?? false,
  };
}
