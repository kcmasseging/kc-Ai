import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { recordAudit } from './auditService';

export interface OwnerSession {
  subject: string;
  role: 'owner';
  issuedAt: number;
  expiresAt: number;
  sessionId: string;
}

export interface AuthResult {
  sessionToken: string;
  expiresAt: number;
  ownerId: string;
}

const sessionTtlMs = 30 * 60 * 1000;
const stepUpTtlMs = 5 * 60 * 1000;
const maxFailures = 5;
const failureWindowMs = 15 * 60 * 1000;
const failures = new Map<string, { count: number; resetAt: number }>();
const revokedSessions = new Set<string>();
const stepUpTokens = new Map<string, number>();

function configuredPasswordHash(): string | undefined {
  return process.env.KC_AI_OWNER_PASSWORD_HASH || process.env.KC_AI_OWNER_BOOTSTRAP_PASSWORD
    ? process.env.KC_AI_OWNER_PASSWORD_HASH || hashPassword(process.env.KC_AI_OWNER_BOOTSTRAP_PASSWORD as string)
    : undefined;
}

export function hashPassword(password: string, salt = randomBytes(16).toString('hex')): string {
  if (!password || password.length < 12) throw new Error('Owner password must be at least 12 characters');
  const derivedKey = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derivedKey}`;
}

function verifyPassword(password: string, encoded: string): boolean {
  const [algorithm, salt, expectedHex] = encoded.split('$');
  if (algorithm !== 'scrypt' || !salt || !expectedHex || !/^[a-f0-9]{128}$/i.test(expectedHex)) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sign(encodedClaims: string, secret: string): string {
  return createHmac('sha256', secret).update(encodedClaims).digest('base64url');
}

function encodeSession(session: OwnerSession, secret: string): string {
  const claims = Buffer.from(JSON.stringify(session)).toString('base64url');
  return `${claims}.${sign(claims, secret)}`;
}

function decodeSession(token: string | undefined, secret: string | undefined, now: number): OwnerSession | undefined {
  if (!token || !secret) return undefined;
  const [encodedClaims, providedSignature] = token.split('.');
  if (!encodedClaims || !providedSignature || token.split('.').length !== 2) return undefined;
  const expectedSignature = sign(encodedClaims, secret);
  const provided = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return undefined;
  try {
    const session = JSON.parse(Buffer.from(encodedClaims, 'base64url').toString('utf8')) as Partial<OwnerSession>;
    if (session.role !== 'owner' || typeof session.subject !== 'string' || typeof session.sessionId !== 'string' || typeof session.issuedAt !== 'number' || typeof session.expiresAt !== 'number' || session.expiresAt <= now || revokedSessions.has(session.sessionId)) return undefined;
    return session as OwnerSession;
  } catch {
    return undefined;
  }
}

function failureKey(identifier: string): string {
  return identifier.trim().toLowerCase() || 'unknown';
}

function isRateLimited(identifier: string, now: number): boolean {
  const entry = failures.get(failureKey(identifier));
  return Boolean(entry && entry.resetAt > now && entry.count >= maxFailures);
}

function noteFailure(identifier: string, now: number): void {
  const key = failureKey(identifier);
  const existing = failures.get(key);
  if (!existing || existing.resetAt <= now) failures.set(key, { count: 1, resetAt: now + failureWindowMs });
  else existing.count += 1;
}

export function authenticateOwner(input: { ownerId: string; password: string; secret: string; now?: number }): AuthResult | undefined {
  const now = input.now ?? Date.now();
  const ownerId = input.ownerId.trim();
  if (isRateLimited(ownerId, now)) {
    recordAudit({ actionType: 'owner.login', actorRole: 'user', outcome: 'blocked', verificationStatus: 'not-verified', error: 'Rate limit exceeded' });
    return undefined;
  }
  const storedHash = configuredPasswordHash();
  const valid = Boolean(storedHash && ownerId === (process.env.KC_AI_OWNER_ID || 'owner') && verifyPassword(input.password, storedHash));
  if (!valid) {
    noteFailure(ownerId, now);
    recordAudit({ actionType: 'owner.login', actorRole: 'user', outcome: 'failed', verificationStatus: 'not-verified', error: 'Invalid owner credentials' });
    return undefined;
  }
  failures.delete(failureKey(ownerId));
  const session: OwnerSession = { subject: ownerId, role: 'owner', issuedAt: now, expiresAt: now + sessionTtlMs, sessionId: randomBytes(18).toString('hex') };
  recordAudit({ actionType: 'owner.login', actorRole: 'owner', outcome: 'completed', verificationStatus: 'verified' });
  return { sessionToken: encodeSession(session, input.secret), expiresAt: session.expiresAt, ownerId };
}

export function verifyOwnerSession(token: string | undefined, secret: string | undefined, now = Date.now()): OwnerSession | undefined {
  return decodeSession(token, secret, now);
}

export function logoutOwner(token: string | undefined, secret: string | undefined): boolean {
  const session = decodeSession(token, secret, Date.now());
  if (!session) return false;
  revokedSessions.add(session.sessionId);
  recordAudit({ actionType: 'owner.logout', actorRole: 'owner', outcome: 'completed', verificationStatus: 'verified' });
  return true;
}

export function issueStepUpToken(input: { token: string | undefined; password: string; secret: string; now?: number }): string | undefined {
  const session = verifyOwnerSession(input.token, input.secret, input.now);
  const storedHash = configuredPasswordHash();
  if (!session || !storedHash || !verifyPassword(input.password, storedHash)) return undefined;
  const stepUpToken = randomBytes(32).toString('base64url');
  stepUpTokens.set(stepUpToken, (input.now ?? Date.now()) + stepUpTtlMs);
  recordAudit({ actionType: 'owner.reauthentication', actorRole: 'owner', outcome: 'completed', verificationStatus: 'verified' });
  return stepUpToken;
}

export function verifyStepUpToken(token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const expiresAt = stepUpTokens.get(token);
  if (!expiresAt || expiresAt <= now) {
    stepUpTokens.delete(token);
    return false;
  }
  return true;
}

export function authConfigurationStatus(): { configured: boolean; mode: 'environment-hash' | 'development-bootstrap' | 'unconfigured' } {
  if (process.env.KC_AI_OWNER_PASSWORD_HASH) return { configured: true, mode: 'environment-hash' };
  if (process.env.KC_AI_ENV !== 'production' && process.env.KC_AI_OWNER_BOOTSTRAP_PASSWORD) return { configured: true, mode: 'development-bootstrap' };
  return { configured: false, mode: 'unconfigured' };
}
