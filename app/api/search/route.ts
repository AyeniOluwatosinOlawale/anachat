import { NextRequest } from 'next/server';
import { checkRateLimit, errorResponse, getClientIP, SECURITY_HEADERS } from '@/lib/security';

export const runtime = 'nodejs';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  content: string;
}

// Extract 1–2 clean factual sentences from a Wikipedia extract
function extractTopFact(extract: string): string {
  const sentences = extract.match(/[^.!?]+[.!?]+/g) ?? [];
  return sentences.slice(0, 2).join(' ').trim();
}

// ─── Wikipedia API — free, reliable, no key, works from any server ────────────

async function searchWikipedia(query: string): Promise<SearchResult[]> {
  try {
    // Step 1: find matching article titles
    const searchRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=3&format=json&origin=*`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!searchRes.ok) return [];
    const [, titles, , urls] = await searchRes.json() as [string, string[], string[], string[]];
    if (!titles.length) return [];

    // Step 2: fetch summaries for top 2 matches
    const results = await Promise.all(
      titles.slice(0, 2).map(async (title, i) => {
        try {
          const res = await fetch(
            `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
            { signal: AbortSignal.timeout(6000) }
          );
          if (!res.ok) return null;
          const data = await res.json() as { title: string; extract?: string };
          return {
            title: data.title,
            url: urls[i] ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
            snippet: data.extract?.slice(0, 300) ?? '',
            content: data.extract ?? '',
          };
        } catch { return null; }
      })
    );
    return results.filter(Boolean) as SearchResult[];
  } catch { return []; }
}

// ─── Jina Reader — fetch full page text for a URL (free, no key) ─────────────

async function fetchPageContent(url: string): Promise<string> {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: 'text/plain', 'X-Return-Format': 'text', 'X-Timeout': '8' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return '';
    return (await res.text())
      .split('\n').filter((l) => l.trim().length > 20).join('\n').slice(0, 3000);
  } catch { return ''; }
}

// ─── Brave Search API — optional upgrade (set BRAVE_SEARCH_API_KEY) ───────────

async function searchBrave(query: string, apiKey: string): Promise<Omit<SearchResult, 'content'>[]> {
  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5&text_decorations=false&search_lang=en`,
      {
        headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': apiKey },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) return [];
    const data = await res.json() as { web?: { results?: { title: string; url: string; description?: string }[] } };
    return (data.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.description ?? '' }));
  } catch { return []; }
}

// ─── DuckDuckGo HTML scraper — fallback ───────────────────────────────────────

async function searchDuckDuckGo(query: string): Promise<Omit<SearchResult, 'content'>[]> {
  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.5', Referer: 'https://duckduckgo.com/',
        },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) return [];
    const html = await res.text();
    const titleMatches = [...html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)];
    const snippetMatches = [...html.matchAll(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];
    const results: Omit<SearchResult, 'content'>[] = [];
    for (let i = 0; i < Math.min(titleMatches.length, 5); i++) {
      const rawHref = titleMatches[i][1];
      const title = titleMatches[i][2].replace(/<[^>]+>/g, '').trim();
      const snippet = (snippetMatches[i]?.[1] ?? '').replace(/<[^>]+>/g, '').trim();
      let url = rawHref;
      try { const uddg = new URL('https://duckduckgo.com' + rawHref).searchParams.get('uddg'); if (uddg) url = decodeURIComponent(uddg); } catch { /* keep raw */ }
      if (title && url && !url.startsWith('//')) results.push({ title, url, snippet });
    }
    return results;
  } catch { return []; }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  const { allowed } = checkRateLimit(`search:${ip}`);
  if (!allowed) return errorResponse('Rate limit exceeded', 429);

  let body: { query?: string };
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }

  const query = body.query?.trim();
  if (!query) return errorResponse('Missing query', 400);
  if (query.length > 300) return errorResponse('Query too long', 400);

  // Run Wikipedia + web search in parallel
  const [wikiResults, braveKey] = await Promise.all([
    searchWikipedia(query),
    Promise.resolve(process.env.BRAVE_SEARCH_API_KEY),
  ]);

  let webBase: Omit<SearchResult, 'content'>[] = [];
  if (braveKey) {
    webBase = await searchBrave(query, braveKey);
  }
  if (webBase.length === 0) {
    webBase = await searchDuckDuckGo(query);
  }

  // Enrich top 2 web results with Jina Reader
  const webEnriched: SearchResult[] = await Promise.all(
    webBase.slice(0, 2).map(async (r) => ({ ...r, content: await fetchPageContent(r.url) }))
  );
  const webExtra: SearchResult[] = webBase.slice(2).map((r) => ({ ...r, content: '' }));

  // Merge: Wikipedia first (most reliable for facts), then web results
  const results = [...wikiResults, ...webEnriched, ...webExtra];

  // Pre-extract the top fact so the model has a single sentence to work from
  const topFact = wikiResults[0]?.content
    ? extractTopFact(wikiResults[0].content)
    : (webEnriched[0]?.snippet ? webEnriched[0].snippet.slice(0, 300) : '');

  return new Response(JSON.stringify({ results, topFact }), {
    headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS },
  });
}
