import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

export interface WebFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  lookupHost?: (hostname: string) => Promise<string[]>;
}

export interface WebFetchResponse {
  url: string;
  contentType: string;
  content: string;
  title?: string;
  readableText?: string;
  summary?: string;
  retrievedAt: string;
  untrustedContent: true;
}

export type WebFetchFailureKind = 'invalid-url' | 'private-network' | 'timeout' | 'too-large' | 'redirect' | 'unsupported-content' | 'provider-error';

export class WebFetchError extends Error {
  constructor(public readonly kind: WebFetchFailureKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'WebFetchError';
  }
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb');
}

function isPrivateAddress(address: string): boolean {
  return isPrivateIpv4(address) || (isIP(address) === 6 && isPrivateIpv6(address));
}

export function extractReadableContent(content: string, contentType: string): { title: string; readableText: string; summary: string } {
  if (contentType === 'text/plain') {
    const readableText = content.replace(/\s+/g, ' ').trim();
    return { title: 'Untitled page', readableText, summary: readableText.slice(0, 600) };
  }
  const title = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || 'Untitled page';
  const readableText = content
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return { title, readableText, summary: readableText.slice(0, 600) };
}

export function validateFetchUrl(input: string): URL {
  let url: URL;
  try { url = new URL(input); } catch (error) { throw new WebFetchError('invalid-url', 'Page URL is invalid', { cause: error }); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new WebFetchError('invalid-url', 'Page URL must use HTTP or HTTPS');
  if (url.username || url.password) throw new WebFetchError('invalid-url', 'Page URL must not contain credentials');
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === 'local' || isPrivateIpv4(hostname) || (isIP(hostname) === 6 && isPrivateIpv6(hostname))) {
    throw new WebFetchError('private-network', 'Private or localhost page retrieval is blocked');
  }
  return url;
}

export async function fetchWebPage(input: string, options: WebFetchOptions = {}): Promise<WebFetchResponse> {
  const url = validateFetchUrl(input);
  const maxBytes = options.maxBytes || 1_000_000;
  try {
    const addresses = await (options.lookupHost || (async (hostname: string) => (await lookup(hostname, { all: true })).map((entry) => entry.address)))(url.hostname);
    if (addresses.some(isPrivateAddress)) throw new WebFetchError('private-network', 'Page hostname resolves to a private or localhost address');
  } catch (error) {
    if (error instanceof WebFetchError) throw error;
    throw new WebFetchError('provider-error', 'Page hostname could not be safely resolved', { cause: error });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 10000);
  let response: Response;
  try {
    response = await fetch(url, { redirect: 'manual', signal: controller.signal, headers: { Accept: 'text/html, application/xhtml+xml, text/plain' } });
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') throw new WebFetchError('timeout', 'Page retrieval timed out', { cause: error });
    throw new WebFetchError('provider-error', 'Page retrieval request failed', { cause: error });
  } finally { clearTimeout(timeout); }
  if (response.status >= 300 && response.status < 400) throw new WebFetchError('redirect', 'Page retrieval redirects are blocked');
  if (!response.ok) throw new WebFetchError('provider-error', `Page retrieval returned HTTP ${response.status}`);
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || '';
  if (!['text/html', 'application/xhtml+xml', 'text/plain'].includes(contentType)) throw new WebFetchError('unsupported-content', 'Page retrieval only permits HTML or plain text');
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) throw new WebFetchError('too-large', 'Page response exceeds the configured size limit');
  if (!response.body) throw new WebFetchError('provider-error', 'Page retrieval returned an empty response body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxBytes) throw new WebFetchError('too-large', 'Page response exceeds the configured size limit');
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const content = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
  const extracted = extractReadableContent(content, contentType);
  return { url: url.toString(), contentType, content, ...extracted, retrievedAt: new Date().toISOString(), untrustedContent: true };
}