import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.json();

  const apiKey = process.env.ANACHAT_API_KEY;
  const baseUrl = process.env.ANACHAT_BASE_URL;

  if (!apiKey || !baseUrl) {
    return new Response(JSON.stringify({ error: 'API configuration missing' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const upstream = await fetch(`${baseUrl}/api/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      ...body,
      stream: true,
    }),
  });

  if (!upstream.ok) {
    const text = await upstream.text();
    return new Response(
      JSON.stringify({ error: `Upstream error: ${upstream.status}`, detail: text }),
      { status: upstream.status, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Stream the SSE response straight back to the client
  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
