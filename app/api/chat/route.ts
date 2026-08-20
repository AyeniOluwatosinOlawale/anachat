import { NextRequest } from 'next/server';
import {
  checkRateLimit,
  errorResponse,
  getClientIP,
  isBodyTooLarge,
  sanitizeChatPayload,
  SECURITY_HEADERS,
  validateChatBody,
} from '@/lib/security';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (isBodyTooLarge(req)) return errorResponse('Request body too large', 413);

  const ip = getClientIP(req);
  const { allowed, remaining } = checkRateLimit(ip);
  if (!allowed) return errorResponse('Rate limit exceeded. Try again in a minute.', 429);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const validationError = validateChatBody(body);
  if (validationError) return errorResponse(validationError, 400);

  const apiKey = process.env.ANACHAT_API_KEY;
  const baseUrl = process.env.ANACHAT_BASE_URL;
  if (!apiKey || !baseUrl) return errorResponse('API configuration missing', 500);

  const payload = sanitizeChatPayload(body);

  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl}/api/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return errorResponse('Failed to reach upstream model', 502);
  }

  if (!upstream.ok) {
    const status = upstream.status;
    if (status === 502 || status === 503 || status === 504) {
      return errorResponse('The AI model server is currently offline. Please try again later.', status);
    }
    return errorResponse(`Model server returned an error (${status}). Please try again.`, status);
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-RateLimit-Remaining': String(remaining),
      ...SECURITY_HEADERS,
    },
  });
}
