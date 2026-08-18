import { NextRequest } from 'next/server';
import { checkRateLimit, errorResponse, getClientIP, SECURITY_HEADERS } from '@/lib/security';

export const runtime = 'nodejs';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  age: string;
}

// ─── DuckDuckGo HTML scraper (free, no key required) ─────────────────────────

async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  const res = await fetch(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        Referer: 'https://duckduckgo.com/',
      },
      signal: AbortSignal.timeout(8000),
    }
  );

  if (!res.ok) return [];

  const html = await res.text();
  const results: SearchResult[] = [];

  // Extract title + href
  const titleMatches = [...html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)];
  // Extract snippets
  const snippetMatches = [...html.matchAll(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];

  for (let i = 0; i < Math.min(titleMatches.length, 6); i++) {
    const rawHref = titleMatches[i][1];
    const rawTitle = titleMatches[i][2].replace(/<[^>]+>/g, '').trim();
    const rawSnippet = (snippetMatches[i]?.[1] ?? '').replace(/<[^>]+>/g, '').trim();

    // Decode DuckDuckGo redirect URLs (/l/?uddg=...)
    let url = rawHref;
    try {
      const uddg = new URL('https://duckduckgo.com' + rawHref).searchParams.get('uddg');
      if (uddg) url = decodeURIComponent(uddg);
    } catch { /* keep raw href */ }

    if (rawTitle && url && !url.startsWith('//')) {
      results.push({ title: rawTitle, url, snippet: rawSnippet, age: '' });
    }
  }

  return results;
}

// ─── Brave Search API ─────────────────────────────────────────────────────────

async function searchBrave(query: string, apiKey: string): Promise<SearchResult[]> {
  const res = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=6&text_decorations=false&search_lang=en`,
    {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
      signal: AbortSignal.timeout(8000),
    }
  );

  if (!res.ok) return [];

  const data = await res.json() as {
    web?: { results?: { title: string; url: string; description?: string; page_age?: string }[] };
  };

  return (data.web?.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description ?? '',
    age: r.page_age ?? '',
  }));
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

  let results: SearchResult[] = [];

  try {
    const braveKey = process.env.BRAVE_SEARCH_API_KEY;
    if (braveKey) {
      results = await searchBrave(query, braveKey);
    }

    // DuckDuckGo fallback (always used when Brave returns nothing or no key)
    if (results.length === 0) {
      results = await searchDuckDuckGo(query);
    }
  } catch {
    // Return empty on any error — caller handles gracefully
  }

  return new Response(JSON.stringify({ results }), {
    headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS },
  });
}
