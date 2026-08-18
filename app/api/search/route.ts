import { NextRequest } from 'next/server';
import { checkRateLimit, errorResponse, getClientIP, SECURITY_HEADERS } from '@/lib/security';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  const { allowed } = checkRateLimit(`search:${ip}`);
  if (!allowed) return errorResponse('Rate limit exceeded', 429);

  let body: { query?: string };
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }

  const query = body.query?.trim();
  if (!query) return errorResponse('Missing query', 400);
  if (query.length > 300) return errorResponse('Query too long', 400);

  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ results: [], disabled: true }), {
      headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS },
    });
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=6&text_decorations=false&search_lang=en`,
      {
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': apiKey,
        },
      }
    );
  } catch {
    return errorResponse('Search service unreachable', 502);
  }

  if (!upstream.ok) {
    return errorResponse(`Search API error: ${upstream.status}`, upstream.status >= 500 ? 502 : upstream.status);
  }

  const data = await upstream.json() as {
    web?: {
      results?: { title: string; url: string; description?: string; page_age?: string }[];
    };
  };

  const results = (data.web?.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description ?? '',
    age: r.page_age ?? '',
  }));

  return new Response(JSON.stringify({ results }), {
    headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS },
  });
}
