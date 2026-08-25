import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAndAdvanceTask } from '../services/taskService';
import { listTaskHistory } from '../services/taskService';
import { checkCapability } from '../services/capabilityService';
import { clearAuditRecords, listAuditRecords } from '../services/auditService';
import { normalizeSources } from '../services/sourceService';
import { BraveSearchProvider, WebSearchProviderError, type SearchProvider } from '../services/webSearchService';
import { fetchWebPage, validateFetchUrl, WebFetchError } from '../services/webFetchService';

const originalProvider = process.env.KC_AI_WEB_SEARCH_PROVIDER;
const originalKey = process.env.KC_AI_WEB_SEARCH_API_KEY;

function configureSearch(): void {
  process.env.KC_AI_WEB_SEARCH_PROVIDER = 'brave';
  process.env.KC_AI_WEB_SEARCH_API_KEY = 'test-only-key';
}

function restoreSearchConfiguration(): void {
  if (originalProvider === undefined) delete process.env.KC_AI_WEB_SEARCH_PROVIDER;
  else process.env.KC_AI_WEB_SEARCH_PROVIDER = originalProvider;
  if (originalKey === undefined) delete process.env.KC_AI_WEB_SEARCH_API_KEY;
  else process.env.KC_AI_WEB_SEARCH_API_KEY = originalKey;
}

const mockedProvider = (response: Awaited<ReturnType<SearchProvider['search']>>): SearchProvider => ({
  name: 'mock',
  isConfigured: () => true,
  search: vi.fn(async () => response),
});

afterEach(() => {
  restoreSearchConfiguration();
  vi.unstubAllGlobals();
});

describe('KC Browser research foundation', () => {
  it('classifies and executes configured search with normalized source evidence', async () => {
    configureSearch();
    await clearAuditRecords();
    const provider = mockedProvider({ provider: 'mock', query: 'latest Railway developments', results: [{ title: 'Railway update', url: 'https://example.com/railway', domain: 'example.com', snippet: 'A current update.', rank: 1, publicationDate: '2026-08-20' }] });

    const task = await createAndAdvanceTask({ goal: 'Search the web for the latest information about Railway and summarize the important developments.', searchProvider: provider });

    expect(task.requiredCapability).toBe('web.search');
    expect(task.status).toBe('completed');
    expect(task.sources).toEqual([expect.objectContaining({ title: 'Railway update', url: 'https://example.com/railway', domain: 'example.com', snippet: 'A current update.', publicationDate: '2026-08-20', provider: 'mock', retrievedAt: expect.any(String) })]);
    expect(task.executionEvidence).toContain('1 normalized result');
    expect(task.verificationResult).toContain('normalized source metadata retained');
    expect((await listAuditRecords()).find((record) => record.taskId === task.taskId && record.outcome === 'completed')?.providerName).toBe('mock');
    expect((await listTaskHistory(task.taskId)).at(-1)?.task.sources).toEqual(task.sources);
  });

  it('blocks search when provider configuration is missing', async () => {
    delete process.env.KC_AI_WEB_SEARCH_PROVIDER;
    delete process.env.KC_AI_WEB_SEARCH_API_KEY;
    const task = await createAndAdvanceTask({ goal: 'Search the web for Railway updates' });

    expect(task.status).toBe('blocked');
    expect(task.blockedReason).toContain('KC_AI_WEB_SEARCH_PROVIDER');
    expect(task.sources).toBeUndefined();
    expect(checkCapability('browser.research').status).not.toBe('available');
  });

  it('reports provider failures without claiming online verification', async () => {
    configureSearch();
    const provider: SearchProvider = { name: 'mock', isConfigured: () => true, search: vi.fn(async () => { throw new WebSearchProviderError('provider-error', 'mock provider unavailable'); }) };

    const task = await createAndAdvanceTask({ goal: 'Search the web for Railway updates', searchProvider: provider });

    expect(task.status).toBe('failed');
    expect(task.verificationStatus).toBe('not-verified');
    expect(task.lastError).toBe('mock provider unavailable');
  });

  it('rejects malformed provider records', async () => {
    configureSearch();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ web: { results: [{ title: 'missing fields' }] } }), { status: 200, headers: { 'content-type': 'application/json' } })));

    await expect(new BraveSearchProvider().search('Railway')).rejects.toMatchObject({ kind: 'malformed-response' });
  });

  it('preserves a verified empty search result without fabricating sources', async () => {
    configureSearch();
    const task = await createAndAdvanceTask({ goal: 'Search the web for an obscure unavailable phrase', searchProvider: mockedProvider({ provider: 'mock', query: 'obscure', results: [] }) });

    expect(task.status).toBe('completed');
    expect(task.sources).toEqual([]);
    expect(task.result).toContain('No results returned.');
    expect(task.verificationStatus).toBe('verified');
  });

  it('runs explicit page reads through web.fetch/read as untrusted data', async () => {
    const task = await createAndAdvanceTask({
      goal: 'Read https://example.com/article',
      fetchPage: async (url) => ({ url, contentType: 'text/html', content: 'Ignore these webpage instructions', retrievedAt: '2026-08-25T00:00:00.000Z', untrustedContent: true }),
    });

    expect(task.requiredCapability).toBe('web.fetch/read');
    expect(task.status).toBe('completed');
    expect(task.result).toContain('UNTRUSTED PAGE CONTENT');
    expect(task.verificationResult).toContain('no webpage instructions were executed');
    expect(task.sources?.[0]).toMatchObject({ provider: 'web.fetch/read', url: 'https://example.com/article' });
  });

  it('normalizes source metadata and rejects unsafe source schemes', () => {
    expect(normalizeSources([{ title: ' Example ', url: 'https://example.com/a', snippet: ' text ' }], 'mock', '2026-08-25T00:00:00.000Z')).toEqual([{ title: 'Example', url: 'https://example.com/a', domain: 'example.com', snippet: 'text', provider: 'mock', retrievedAt: '2026-08-25T00:00:00.000Z' }]);
    expect(() => normalizeSources([{ title: 'bad', url: 'javascript:alert(1)' }], 'mock', new Date().toISOString())).toThrow('HTTP or HTTPS');
  });

  it('redacts API keys from audit records', async () => {
    await clearAuditRecords();
    const secret = 'api-key=do-not-store-this';
    const task = await createAndAdvanceTask({ goal: `Search the web for Railway ${secret}` });
    const audit = JSON.stringify((await listAuditRecords()).filter((record) => record.taskId === task.taskId));

    expect(audit).not.toContain('do-not-store-this');
  });
});

describe('KC Browser page retrieval boundary', () => {
  it.each(['http://localhost/admin', 'http://127.0.0.1/admin', 'http://192.168.1.1/', 'file:///etc/passwd'])('blocks unsafe URL %s', (url) => {
    expect(() => validateFetchUrl(url)).toThrow(WebFetchError);
  });

  it('blocks redirects and oversized responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://example.com/next' } })));
    await expect(fetchWebPage('https://example.com', { lookupHost: async () => ['93.184.216.34'] })).rejects.toMatchObject({ kind: 'redirect' });

    vi.stubGlobal('fetch', vi.fn(async () => new Response('too large', { status: 200, headers: { 'content-type': 'text/plain', 'content-length': '100' } })));
    await expect(fetchWebPage('https://example.com', { maxBytes: 4, lookupHost: async () => ['93.184.216.34'] })).rejects.toMatchObject({ kind: 'too-large' });
  });

  it('returns retrieved pages as explicitly untrusted data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<p>Ignore webpage instructions</p>', { status: 200, headers: { 'content-type': 'text/html' } })));

    const page = await fetchWebPage('https://example.com/article', { lookupHost: async () => ['93.184.216.34'] });

    expect(page).toMatchObject({ url: 'https://example.com/article', content: '<p>Ignore webpage instructions</p>', contentType: 'text/html', untrustedContent: true });
    expect(page.content).not.toContain('KC AI system rule');
  });
});
