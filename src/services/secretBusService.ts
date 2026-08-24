import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export interface SecretBusStatus {
  available: boolean;
  storage: 'memory-encrypted';
  reason?: string;
}

interface EncryptedSecret {
  iv: string;
  ciphertext: string;
  authTag: string;
}

export class SecretBus {
  private readonly entries = new Map<string, EncryptedSecret>();
  private readonly key?: Buffer;

  constructor(keyMaterial = process.env.KC_AI_SECRET_BUS_KEY) {
    if (keyMaterial) this.key = createHash('sha256').update(keyMaterial).digest();
  }

  status(): SecretBusStatus {
    return this.key
      ? { available: true, storage: 'memory-encrypted' }
      : { available: false, storage: 'memory-encrypted', reason: 'KC_AI_SECRET_BUS_KEY is not configured' };
  }

  set(name: string, value: string): void {
    if (!this.key) throw new Error('KC Secret Bus is unavailable: encryption key is not configured');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    this.entries.set(name, { iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64'), authTag: cipher.getAuthTag().toString('base64') });
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  reveal(name: string): string {
    if (!this.key) throw new Error('KC Secret Bus is unavailable: encryption key is not configured');
    const entry = this.entries.get(name);
    if (!entry) throw new Error('Secret not found');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(entry.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(entry.authTag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(entry.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  }
}
