import { NextRequest } from 'next/server';
import {
  checkRateLimit,
  errorResponse,
  getClientIP,
  isBodyTooLarge,
  sanitizeImagePayload,
  SECURITY_HEADERS,
  validateImageBody,
} from '@/lib/security';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (isBodyTooLarge(req)) return errorResponse('Request body too large', 413);

  const ip = getClientIP(req);
  // Image generation costs more — tighter limit (10 per minute)
  const { allowed } = checkRateLimit(`img:${ip}`);
  if (!allowed) return errorResponse('Rate limit exceeded. Try again in a minute.', 429);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const validationError = validateImageBody(body);
  if (validationError) return errorResponse(validationError, 400);

  const apiKey = process.env.ANACHAT_API_KEY;
  const baseUrl = process.env.ANACHAT_BASE_URL;
  if (!apiKey || !baseUrl) return errorResponse('API configuration missing', 500);

  const payload = sanitizeImagePayload(body);

  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl}/image/v1/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return errorResponse('Failed to reach image service', 502);
  }

  let data: unknown;
  try {
    data = await upstream.json();
  } catch {
    return errorResponse('Invalid response from image service', 502);
  }

  if (!upstream.ok) {
    // Surface the upstream error message clearly
    const upstreamMsg =
      (data as { error?: { message?: string } })?.error?.message ??
      `Image service returned ${upstream.status}`;
    return errorResponse(upstreamMsg, upstream.status >= 500 ? 502 : upstream.status);
  }

  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS },
  });
}
