import { NextRequest } from 'next/server';
import { checkRateLimit, errorResponse, getClientIP, SECURITY_HEADERS } from '@/lib/security';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  const { allowed } = checkRateLimit(`embed:${ip}`);
  if (!allowed) return errorResponse('Rate limit exceeded', 429);

  const apiKey = req.headers.get('x-api-key') ?? req.headers.get('authorization')?.replace('Bearer ', '');
  if (apiKey !== process.env.EMBEDDING_API_KEY) {
    return errorResponse('Invalid or missing API key', 401);
  }

  let body: unknown;
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }

  const embeddingServer = process.env.EMBEDDING_SERVER_URL ?? 'http://localhost:8765';

  let upstream: Response;
  try {
    upstream = await fetch(`${embeddingServer}/v1/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.EMBEDDING_API_KEY ?? '',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    return errorResponse('Embedding server unreachable. Make sure it is running on your machine.', 502);
  }

  if (!upstream.ok) {
    return errorResponse(`Embedding server error (${upstream.status})`, upstream.status);
  }

  const data = await upstream.json();
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS },
  });
}

export async function GET() {
  const embeddingServer = process.env.EMBEDDING_SERVER_URL ?? 'http://localhost:8765';
  try {
    const res = await fetch(`${embeddingServer}/health`, { signal: AbortSignal.timeout(5000) });
    const data = await res.json() as { status: string; model: string; ready: boolean };
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS },
    });
  } catch {
    return new Response(JSON.stringify({ status: 'offline', ready: false }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS },
    });
  }
}
