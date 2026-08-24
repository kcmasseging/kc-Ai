import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

export type SecretType = 'password' | 'api-key' | 'token' | 'private-note' | 'project-secret' | 'document';

export interface SecretBusRecord {
  id: string;
  ownerId: string;
  type: SecretType;
  label: string;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt?: string;
  version: number;
  tags?: string[];
  projectReference?: string;
  encryptedPayload: { iv: string; ciphertext: string; authTag: string };
}

export interface SecretMetadata extends Omit<SecretBusRecord, 'encryptedPayload'> {
  maskedValue: string;
}

export interface SecretBusStatus {
  available: boolean;
  storage: 'encrypted-json';
  reason?: string;
}

export class SecretBus {
  private readonly records = new Map<string, SecretBusRecord>();
  private readonly key?: Buffer;
  private readonly filePath: string;

  constructor(keyMaterial = process.env.KC_AI_SECRET_BUS_KEY, filePath = process.env.KC_AI_SECRET_BUS_PATH || '.kc-ai-secrets.json') {
    this.filePath = filePath;
    if (keyMaterial) this.key = createHash('sha256').update(keyMaterial).digest();
    this.load();
  }

  status(): SecretBusStatus {
    return this.key
      ? { available: true, storage: 'encrypted-json' }
      : { available: false, storage: 'encrypted-json', reason: 'KC_AI_SECRET_BUS_KEY is not configured' };
  }

  list(ownerId: string): SecretMetadata[] {
    return [...this.records.values()].filter((record) => record.ownerId === ownerId).map((record) => this.metadata(record));
  }

  get(ownerId: string, id: string): SecretMetadata | undefined {
    const record = this.records.get(id);
    return record?.ownerId === ownerId ? this.metadata(record) : undefined;
  }

  create(input: { ownerId: string; type: SecretType; label: string; value: string; tags?: string[]; projectReference?: string }): SecretMetadata {
    this.requireKey();
    const now = new Date().toISOString();
    const record: SecretBusRecord = { id: `secret_${randomBytes(12).toString('hex')}`, ownerId: input.ownerId, type: input.type, label: input.label.trim(), createdAt: now, updatedAt: now, version: 1, tags: input.tags, projectReference: input.projectReference, encryptedPayload: this.encrypt(input.value) };
    this.records.set(record.id, record);
    this.persist();
    return this.metadata(record);
  }

  update(ownerId: string, id: string, input: { label?: string; value?: string; tags?: string[]; projectReference?: string }): SecretMetadata | undefined {
    this.requireKey();
    const record = this.records.get(id);
    if (!record || record.ownerId !== ownerId) return undefined;
    if (input.value !== undefined) record.encryptedPayload = this.encrypt(input.value);
    if (input.label !== undefined) record.label = input.label.trim();
    if (input.tags !== undefined) record.tags = input.tags;
    if (input.projectReference !== undefined) record.projectReference = input.projectReference;
    record.version += 1;
    record.updatedAt = new Date().toISOString();
    this.persist();
    return this.metadata(record);
  }

  reveal(ownerId: string, id: string): string | undefined {
    this.requireKey();
    const record = this.records.get(id);
    if (!record || record.ownerId !== ownerId) return undefined;
    record.lastAccessedAt = new Date().toISOString();
    this.persist();
    return this.decrypt(record.encryptedPayload);
  }

  delete(ownerId: string, id: string): boolean {
    const record = this.records.get(id);
    if (!record || record.ownerId !== ownerId) return false;
    this.records.delete(id);
    this.persist();
    return true;
  }

  private requireKey(): Buffer {
    if (!this.key) throw new Error('KC Secret Bus is unavailable: encryption key is not configured');
    return this.key;
  }

  private encrypt(value: string): SecretBusRecord['encryptedPayload'] {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.requireKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return { iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64'), authTag: cipher.getAuthTag().toString('base64') };
  }

  private decrypt(payload: SecretBusRecord['encryptedPayload']): string {
    const decipher = createDecipheriv('aes-256-gcm', this.requireKey(), Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  }

  private metadata(record: SecretBusRecord): SecretMetadata {
    const { encryptedPayload: _encryptedPayload, ...safeRecord } = record;
    return { ...safeRecord, maskedValue: '********' };
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const stored = JSON.parse(readFileSync(this.filePath, 'utf8')) as SecretBusRecord[];
      for (const record of stored) if (record.id && record.ownerId && record.encryptedPayload) this.records.set(record.id, record);
    } catch {}
  }

  private persist(): void {
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    const directory = this.filePath.includes('/') ? this.filePath.slice(0, this.filePath.lastIndexOf('/')) : '.';
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(temporaryPath, JSON.stringify([...this.records.values()]), { mode: 0o600 });
    renameSync(temporaryPath, this.filePath);
  }
}
