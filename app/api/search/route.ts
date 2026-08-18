import { NextRequest } from 'next/server';
import { checkRateLimit, errorResponse, getClientIP, SECURITY_HEADERS } from '@/lib/security';

export const runtime = 'nodejs';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  content: string;
}

// ─── Jina Reader — fetch full page text for a URL (free, no key needed) ───────

async function fetchPageContent(url: string): Promise<string> {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        Accept: 'text/plain',
        'X-Return-Format': 'text',
        'X-Timeout': '8',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return '';
    const text = await res.text();
    // Keep only lines with meaningful content (>20 chars), cap at 3000 chars
    return text
      .split('\n')
      .filter((l) => l.trim().length > 20)
      .join('\n')
      .slice(0, 3000);
  } catch {
    return '';
  }
}

// ─── DuckDuckGo HTML scraper — extracts top URLs and snippets ─────────────────

async function searchDuckDuckGo(query: string): Promise<{ title: string; url: string; snippet: string }[]> {
  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.5',
          Referer: 'https://duckduckgo.com/',
        },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) return [];
    const html = await res.text();

    const titleMatches = [...html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)];
    const snippetMatches = [...html.matchAll(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];
    const results: { title: string; url: string; snippet: string }[] = [];

    for (let i = 0; i < Math.min(titleMatches.length, 5); i++) {
      const rawHref = titleMatches[i][1];
      const title = titleMatches[i][2].replace(/<[^>]+>/g, '').trim();
      const snippet = (snippetMatches[i]?.[1] ?? '').replace(/<[^>]+>/g, '').trim();
      let url = rawHref;
      try {
        const uddg = new URL('https://duckduckgo.com' + rawHref).searchParams.get('uddg');
        if (uddg) url = decodeURIComponent(uddg);
      } catch { /* keep raw */ }
      if (title && url && !url.startsWith('//')) results.push({ title, url, snippet });
    }
    return results;
  } catch {
    return [];
  }
}

// ─── Brave Search API — optional upgrade (set BRAVE_SEARCH_API_KEY) ───────────

async function searchBrave(query: string, apiKey: string): Promise<{ title: string; url: string; snippet: string }[]> {
  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5&text_decorations=false&search_lang=en`,
      {
        headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': apiKey },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) return [];
    const data = await res.json() as {
      web?: { results?: { title: string; url: string; description?: string }[] };
    };
    return (data.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.description ?? '' }));
  } catch {
    return [];
  }
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

  // Step 1: Get URLs via Brave (if key set) or DuckDuckGo
  const braveKey = process.env.BRAVE_SEARCH_API_KEY;
  let baseResults = braveKey
    ? await searchBrave(query, braveKey)
    : await searchDuckDuckGo(query);

  // Fallback if primary search returned nothing
  if (baseResults.length === 0) {
    baseResults = await searchDuckDuckGo(query);
  }

  // Step 2: Enrich top 3 results with full page content via Jina Reader
  const results: SearchResult[] = await Promise.all(
    baseResults.slice(0, 3).map(async (r) => ({
      ...r,
      content: await fetchPageContent(r.url),
    }))
  );

  // Also include remaining results (4-5) with snippets only
  const extra: SearchResult[] = baseResults.slice(3).map((r) => ({ ...r, content: '' }));

  return new Response(JSON.stringify({ results: [...results, ...extra] }), {
    headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS },
  });
}
