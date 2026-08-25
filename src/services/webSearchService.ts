export interface WebSearchOptions {
  limit?: number;
  timeoutMs?: number;
}

export interface WebSearchResult {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  rank: number;
  publicationDate?: string;
}

export interface WebSearchResponse {
  provider: string;
  query: string;
  results: WebSearchResult[];
}

export type WebSearchFailureKind = 'configuration' | 'authentication' | 'rate-limit' | 'timeout' | 'malformed-response' | 'provider-error';

export class WebSearchProviderError extends Error {
  constructor(public readonly kind: WebSearchFailureKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'WebSearchProviderError';
  }
}

export interface SearchProvider {
  readonly name: string;
  isConfigured(): boolean;
  search(query: string, options?: WebSearchOptions): Promise<WebSearchResponse>;
}

function providerName(): string | undefined { return process.env.KC_AI_WEB_SEARCH_PROVIDER?.trim().toLowerCase() || undefined; }
function apiKey(): string | undefined { return process.env.KC_AI_WEB_SEARCH_API_KEY?.trim() || undefined; }
function exaApiKey(): string | undefined { return process.env.EXA_API_KEY?.trim() || undefined; }

export class BraveSearchProvider implements SearchProvider {
  readonly name = 'brave';

  isConfigured(): boolean { return providerName() === this.name && Boolean(apiKey()); }

  async search(query: string, options: WebSearchOptions = {}): Promise<WebSearchResponse> {
    if (!this.isConfigured()) throw new WebSearchProviderError('configuration', 'KC_AI_WEB_SEARCH_PROVIDER=brave and KC_AI_WEB_SEARCH_API_KEY are required');
    const endpoint = process.env.KC_AI_WEB_SEARCH_ENDPOINT?.trim() || 'https://api.search.brave.com/res/v1/web/search';
    const url = new URL(endpoint);
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(Math.min(Math.max(options.limit || 5, 1), 10)));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 10000);
    let response: Response;
    try {
      response = await fetch(url, { headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey()! }, signal: controller.signal });
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') throw new WebSearchProviderError('timeout', 'Web search provider timed out', { cause: error });
      throw new WebSearchProviderError('provider-error', 'Web search provider request failed', { cause: error });
    } finally { clearTimeout(timeout); }
    if (response.status === 401 || response.status === 403) throw new WebSearchProviderError('authentication', 'Web search provider authentication failed');
    if (response.status === 429) throw new WebSearchProviderError('rate-limit', 'Web search provider quota or rate limit reached');
    if (!response.ok) throw new WebSearchProviderError('provider-error', `Web search provider returned HTTP ${response.status}`);
    let body: unknown;
    try { body = await response.json(); } catch (error) { throw new WebSearchProviderError('malformed-response', 'Web search provider returned invalid JSON', { cause: error }); }
    const items = (body as { web?: { results?: unknown } })?.web?.results;
    if (!Array.isArray(items)) throw new WebSearchProviderError('malformed-response', 'Web search provider response did not contain web results');
    const results = items.map((item, index) => {
      const value = item as { title?: unknown; url?: unknown; description?: unknown; page_age?: unknown; published?: unknown };
      if (typeof value.title !== 'string' || typeof value.url !== 'string' || typeof value.description !== 'string') return undefined;
      let domain: string;
      try { domain = new URL(value.url).hostname; } catch { domain = 'unknown'; }
      const publicationDate = typeof value.published === 'string' ? value.published : typeof value.page_age === 'string' ? value.page_age : undefined;
      return { title: value.title, url: value.url, domain, snippet: value.description, ...(publicationDate ? { publicationDate } : {}), rank: index + 1 };
    }).filter((result): result is WebSearchResult => Boolean(result));
    if (items.length > 0 && results.length === 0) throw new WebSearchProviderError('malformed-response', 'Web search provider returned no valid result records');
    return { provider: this.name, query, results };
  }
}

export class ExaSearchProvider implements SearchProvider {
  readonly name = 'exa';

  isConfigured(): boolean { return Boolean(exaApiKey()) && (!providerName() || providerName() === this.name); }

  async search(query: string, options: WebSearchOptions = {}): Promise<WebSearchResponse> {
    if (!this.isConfigured()) throw new WebSearchProviderError('configuration', 'EXA_API_KEY is required for the Exa web search provider');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 10000);
    let response: Response;
    try {
      response = await fetch('https://api.exa.ai/search', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'x-api-key': exaApiKey()! },
        body: JSON.stringify({ query, numResults: Math.min(Math.max(options.limit || 5, 1), 10) }),
        signal: controller.signal,
      });
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') throw new WebSearchProviderError('timeout', 'Web search provider timed out', { cause: error });
      throw new WebSearchProviderError('provider-error', 'Web search provider request failed', { cause: error });
    } finally { clearTimeout(timeout); }
    if (response.status === 401 || response.status === 403) throw new WebSearchProviderError('authentication', 'Web search provider authentication failed');
    if (response.status === 429) throw new WebSearchProviderError('rate-limit', 'Web search provider quota or rate limit reached');
    if (!response.ok) throw new WebSearchProviderError('provider-error', `Web search provider returned HTTP ${response.status}`);
    let body: unknown;
    try { body = await response.json(); } catch (error) { throw new WebSearchProviderError('malformed-response', 'Web search provider returned invalid JSON', { cause: error }); }
    const items = (body as { results?: unknown })?.results;
    if (!Array.isArray(items)) throw new WebSearchProviderError('malformed-response', 'Web search provider response did not contain results');
    const results = items.map((item, index) => {
      const value = item as { title?: unknown; url?: unknown; publishedDate?: unknown; highlights?: unknown };
      if (typeof value.url !== 'string') return undefined;
      let domain: string;
      try { domain = new URL(value.url).hostname; } catch { domain = 'unknown'; }
      const highlights = Array.isArray(value.highlights) ? value.highlights.filter((highlight): highlight is string => typeof highlight === 'string') : [];
      const publicationDate = typeof value.publishedDate === 'string' ? value.publishedDate : undefined;
      return {
        title: typeof value.title === 'string' ? value.title : 'Untitled source',
        url: value.url,
        domain,
        snippet: highlights.join(' '),
        ...(publicationDate ? { publicationDate } : {}),
        rank: index + 1,
      };
    }).filter((result): result is WebSearchResult => Boolean(result));
    if (items.length > 0 && results.length === 0) throw new WebSearchProviderError('malformed-response', 'Web search provider returned no valid result records');
    return { provider: this.name, query, results };
  }
}

export function getWebSearchProvider(): SearchProvider {
  return providerName() === 'brave' ? new BraveSearchProvider() : new ExaSearchProvider();
}

export function getWebSearchConfiguration(): { configured: boolean; provider?: string; reason?: string } {
  const provider = providerName();
  if (provider === 'brave') {
    if (!apiKey()) return { configured: false, provider, reason: 'KC_AI_WEB_SEARCH_API_KEY is not configured' };
    return { configured: true, provider };
  }
  if (provider && provider !== 'exa') return { configured: false, provider, reason: `Unsupported web search provider: ${provider}` };
  if (exaApiKey()) return { configured: true, provider: 'exa' };
  return { configured: false, provider, reason: 'EXA_API_KEY is not configured; KC_AI_WEB_SEARCH_PROVIDER is not configured' };
}