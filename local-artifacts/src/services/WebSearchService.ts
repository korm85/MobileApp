import { loadTavilyApiKey } from './StorageService';

export type WebSearchResult = {
  title: string;
  url: string;
  content: string;
  score?: number;
};

export type WebSearchResponse = {
  query: string;
  results: WebSearchResult[];
  responseTime?: number;
};

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';

async function requestTavily(query: string, depth: 'basic' | 'advanced', apiKeyOverride?: string): Promise<WebSearchResponse> {
  const apiKey = apiKeyOverride?.trim() || await loadTavilyApiKey();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  else headers['X-Tavily-Access-Mode'] = 'keyless';

  const response = await fetch(TAVILY_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: query.trim().slice(0, 400),
      search_depth: depth,
      topic: 'general',
      max_results: 5,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
    }),
  });

  const body = await response.json().catch(() => null) as { detail?: { error?: string } | string; results?: WebSearchResult[]; query?: string; response_time?: number } | null;
  if (!response.ok) {
    const detail = typeof body?.detail === 'string' ? body.detail : body?.detail?.error;
    throw new Error(detail || `Web search failed (${response.status}).`);
  }

  return {
    query: body?.query || query,
    results: Array.isArray(body?.results) ? body.results.filter((item) => item?.title && item?.url).slice(0, 5) : [],
    responseTime: body?.response_time,
  };
}

export async function searchWeb(query: string, depth: 'basic' | 'advanced' = 'basic', apiKeyOverride?: string) {
  if (!query.trim()) throw new Error('Enter a search query.');
  return requestTavily(query, depth, apiKeyOverride);
}

export function formatSearchContext(search: WebSearchResponse) {
  if (search.results.length === 0) return '';
  const sources = search.results.map((result, index) => {
    const content = result.content.replace(/\s+/g, ' ').trim().slice(0, 1200);
    return `[${index + 1}] ${result.title}\nURL: ${result.url}\nContent: ${content}`;
  }).join('\n\n');
  return `WEB SEARCH RESULTS\nQuery: ${search.query}\nUse these sources for current facts and cite them as [1], [2], etc.\n\n${sources}`;
}

export function formatSourcesForMessage(search: WebSearchResponse) {
  if (search.results.length === 0) return '';
  return `\n\nSources:\n${search.results.map((result, index) => `[${index + 1}] ${result.title} — ${result.url}`).join('\n')}`;
}
