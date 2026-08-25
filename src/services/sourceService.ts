export interface SourceMetadata {
  title: string;
  url: string;
  domain: string;
  snippet?: string;
  publicationDate?: string;
  provider: string;
  retrievedAt: string;
}

export function normalizeSources(input: Array<{ title: string; url: string; domain?: string; snippet?: string; publicationDate?: string }>, provider: string, retrievedAt: string): SourceMetadata[] {
  return input.map((source) => {
    const url = new URL(source.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Source URL must use HTTP or HTTPS');
    return {
      title: source.title.trim(),
      url: url.toString(),
      domain: source.domain || url.hostname,
      snippet: source.snippet?.trim() || undefined,
      publicationDate: source.publicationDate,
      provider,
      retrievedAt,
    };
  });
}