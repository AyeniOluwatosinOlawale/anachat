import { NextRequest } from 'next/server';

// ─── Allowed models ───────────────────────────────────────────────────────────
const ALLOWED_CHAT_MODELS = new Set(['phi-4', 'qwen']);
const ALLOWED_IMAGE_SIZES = new Set(['256x256', '512x512', '1024x1024']);

// ─── Limits ───────────────────────────────────────────────────────────────────
const MAX_MESSAGES = 50;
const MAX_MESSAGE_CHARS = 8000;    // per message
const MAX_PROMPT_CHARS = 2000;     // image prompt
const MAX_TOKENS_CAP = 2048;
const MAX_BODY_BYTES = 64 * 1024;  // 64 KB hard limit

// ─── Rate limiter (in-memory, per serverless instance) ────────────────────────
// Sliding window: max 30 requests per 60 seconds per IP.
const RATE_LIMIT = 30;
const WINDOW_MS = 60_000;

interface WindowEntry { count: number; windowStart: number }
const rateLimitMap = new Map<string, WindowEntry>();

// Prune old entries every 5 minutes to avoid unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now - entry.windowStart > WINDOW_MS) rateLimitMap.delete(key);
  }
}, 300_000);

export function checkRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return { allowed: true, remaining: RATE_LIMIT - 1 };
  }

  entry.count++;
  const remaining = Math.max(0, RATE_LIMIT - entry.count);
  return { allowed: entry.count <= RATE_LIMIT, remaining };
}

// ─── IP extraction ────────────────────────────────────────────────────────────
export function getClientIP(req: NextRequest): string {
  return (
    req.headers.get('x-real-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    'unknown'
  );
}

// ─── Body size guard ──────────────────────────────────────────────────────────
export function isBodyTooLarge(req: NextRequest): boolean {
  const length = parseInt(req.headers.get('content-length') ?? '0', 10);
  return length > MAX_BODY_BYTES;
}

// ─── Chat request validation ──────────────────────────────────────────────────
interface Message { role: string; content: string }

export function validateChatBody(body: Record<string, unknown>): string | null {
  const { model, messages } = body;

  if (!model || typeof model !== 'string') return 'Missing or invalid model';
  if (!ALLOWED_CHAT_MODELS.has(model)) {
    return `Model "${model}" is not allowed. Allowed: ${[...ALLOWED_CHAT_MODELS].join(', ')}`;
  }

  if (!Array.isArray(messages) || messages.length === 0) return 'messages must be a non-empty array';
  if (messages.length > MAX_MESSAGES) return `Too many messages (max ${MAX_MESSAGES})`;

  for (const msg of messages as Message[]) {
    if (!msg.role || !['user', 'assistant', 'system'].includes(msg.role)) {
      return `Invalid role "${msg.role}"`;
    }
    if (typeof msg.content !== 'string') return 'Message content must be a string';
    if (msg.content.length > MAX_MESSAGE_CHARS) {
      return `Message exceeds ${MAX_MESSAGE_CHARS} character limit`;
    }
  }

  return null;
}

// ─── Image request validation ─────────────────────────────────────────────────
export function validateImageBody(body: Record<string, unknown>): string | null {
  const { prompt, size } = body;

  if (!prompt || typeof prompt !== 'string') return 'Missing or invalid prompt';
  if (prompt.trim().length === 0) return 'Prompt cannot be empty';
  if (prompt.length > MAX_PROMPT_CHARS) return `Prompt exceeds ${MAX_PROMPT_CHARS} character limit`;

  if (size && !ALLOWED_IMAGE_SIZES.has(size as string)) {
    return `Invalid size. Allowed: ${[...ALLOWED_IMAGE_SIZES].join(', ')}`;
  }

  return null;
}

// ─── Sanitize the forwarded chat payload ─────────────────────────────────────
// Strip any client-supplied keys that could override upstream behaviour
export function sanitizeChatPayload(body: Record<string, unknown>): Record<string, unknown> {
  const messages = (body.messages as Message[]).map((m) => ({
    role: m.role,
    content: m.content.slice(0, MAX_MESSAGE_CHARS),
  }));

  const maxTokens =
    typeof body.max_tokens === 'number'
      ? Math.min(body.max_tokens, MAX_TOKENS_CAP)
      : MAX_TOKENS_CAP;

  return {
    model: body.model,
    messages,
    max_tokens: maxTokens,
    stream: true,
    // never forward: temperature overrides, top_p, n, user identifiers, etc.
  };
}

// ─── Sanitize the forwarded image payload ────────────────────────────────────
export function sanitizeImagePayload(body: Record<string, unknown>): Record<string, unknown> {
  return {
    prompt: (body.prompt as string).slice(0, MAX_PROMPT_CHARS),
    size: ALLOWED_IMAGE_SIZES.has(body.size as string) ? body.size : '1024x1024',
    steps: typeof body.steps === 'number' ? Math.min(Math.max(body.steps, 1), 8) : 4,
  };
}

// ─── Standard security headers ────────────────────────────────────────────────
export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

// ─── Error response helper ────────────────────────────────────────────────────
export function errorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS },
  });
}
