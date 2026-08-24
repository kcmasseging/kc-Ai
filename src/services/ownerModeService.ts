import { createHmac, timingSafeEqual } from 'node:crypto';

export interface OwnerClaims {
  subject: string;
  role: 'owner';
  expiresAt: number;
}

function decodePart(value: string): string | undefined {
  try {
    return Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    return undefined;
  }
}

export function verifyOwnerToken(token: string | undefined, secret: string | undefined, now = Date.now()): OwnerClaims | undefined {
  if (!token || !secret) return undefined;
  const [encodedClaims, providedSignature] = token.split('.');
  if (!encodedClaims || !providedSignature) return undefined;
  const expectedSignature = createHmac('sha256', secret).update(encodedClaims).digest('base64url');
  const provided = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return undefined;
  const decoded = decodePart(encodedClaims);
  if (!decoded) return undefined;
  try {
    const claims = JSON.parse(decoded) as Partial<OwnerClaims>;
    if (claims.role !== 'owner' || typeof claims.subject !== 'string' || !claims.subject || typeof claims.expiresAt !== 'number' || claims.expiresAt <= now) return undefined;
    return { subject: claims.subject, role: 'owner', expiresAt: claims.expiresAt };
  } catch {
    return undefined;
  }
}
