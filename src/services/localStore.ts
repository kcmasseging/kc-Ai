import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

export function loadJsonArray<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

export function writeJsonArray<T>(filePath: string, values: T[]): void {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  let fileDescriptor: number | undefined;
  try {
    fileDescriptor = openSync(temporaryPath, 'w', 0o600);
    writeSync(fileDescriptor, JSON.stringify(values));
    fsyncSync(fileDescriptor);
    closeSync(fileDescriptor);
    fileDescriptor = undefined;
    renameSync(temporaryPath, filePath);
  } catch (error) {
    if (fileDescriptor !== undefined) closeSync(fileDescriptor);
    try { unlinkSync(temporaryPath); } catch {}
    throw error;
  }
}