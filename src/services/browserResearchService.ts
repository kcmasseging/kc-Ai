import { getWebSearchProvider, type SearchProvider, type WebSearchOptions, type WebSearchResponse } from './webSearchService';
import { normalizeSources, type SourceMetadata } from './sourceService';

export interface BrowserResearchResult {
  response: WebSearchResponse;
  sources: SourceMetadata[];
  retrievedAt: string;
}

export async function researchWeb(query: string, options?: WebSearchOptions, provider: SearchProvider = getWebSearchProvider()): Promise<BrowserResearchResult> {
  const response = await provider.search(query, options);
  const retrievedAt = new Date().toISOString();
  return { response, sources: normalizeSources(response.results, response.provider, retrievedAt), retrievedAt };
}