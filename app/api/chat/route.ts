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

const RESPONSES_API_MODELS = new Set(['gpt-6-astra']);
const CHAT_COMPLETIONS_MODELS = new Set(['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo']);

// Strip <think>...</think> from the stream.
// Strategy: buffer all content until </think> is seen, then stream everything after it.
// If no think block exists, emit everything on [DONE].
function stripThinkingStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return new ReadableStream({
    async start(controller) {
      const reader = body.getReader();
      let lineBuffer = '';
      let thinkDone = false;   // true once </think> has been found
      let accumulated = '';    // buffer while still inside/before think block

      const emit = (content: string) => {
        if (!content) return;
        const chunk = { choices: [{ delta: { content }, finish_reason: null }] };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          lineBuffer += decoder.decode(value, { stream: true });
          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();

            if (data === '[DONE]') {
              // If model never had a think block, flush everything accumulated
              if (!thinkDone && accumulated) emit(accumulated);
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              continue;
            }

            try {
              const chunk = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
              const content = chunk.choices?.[0]?.delta?.content;
              if (!content) continue;

              if (thinkDone) {
                // Past the think block — stream directly
                emit(content);
              } else {
                accumulated += content;
                const endIdx = accumulated.indexOf('</think>');
                if (endIdx !== -1) {
                  thinkDone = true;
                  // Emit only the part after </think>, stripping leading newlines
                  const after = accumulated.slice(endIdx + 8).replace(/^\n+/, '');
                  accumulated = '';
                  emit(after);
                }
                // else: still inside think block, keep buffering
              }
            } catch { /* skip malformed */ }
          }
        }
      } finally {
        controller.close();
        reader.releaseLock();
      }
    },
  });
}

// Transform OpenAI Responses API SSE → chat completions SSE format
function transformResponsesStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  return new ReadableStream({
    async start(controller) {
      const reader = body.getReader();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') { controller.enqueue(encoder.encode('data: [DONE]\n\n')); continue; }
            try {
              const event = JSON.parse(data) as { type?: string; delta?: string };
              if (event.type === 'response.output_text.delta' && event.delta) {
                const chunk = { choices: [{ delta: { content: event.delta }, finish_reason: null }] };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
              } else if (event.type === 'response.completed' || event.type === 'response.failed') {
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              }
            } catch { /* skip */ }
          }
        }
      } finally { controller.close(); reader.releaseLock(); }
    },
  });
}

export async function POST(req: NextRequest) {
  if (isBodyTooLarge(req)) return errorResponse('Request body too large', 413);

  const ip = getClientIP(req);
  const { allowed, remaining } = checkRateLimit(ip);
  if (!allowed) return errorResponse('Rate limit exceeded. Try again in a minute.', 429);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON body', 400); }

  const validationError = validateChatBody(body);
  if (validationError) return errorResponse(validationError, 400);

  const payload = sanitizeChatPayload(body);
  const model = body.model as string;
  const isOpenAI = RESPONSES_API_MODELS.has(model) || CHAT_COMPLETIONS_MODELS.has(model);
  const isThinkingModel = model.startsWith('qwen3') || model === 'AnaModel';

  let upstream: Response;
  let useResponsesApi = false;

  if (isOpenAI) {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) return errorResponse('OpenAI API key not configured', 500);
    useResponsesApi = RESPONSES_API_MODELS.has(model);
    const messages = payload.messages as { role: string; content: string }[];
    try {
      if (useResponsesApi) {
        upstream = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
          body: JSON.stringify({ model, input: messages, stream: true }),
        });
      } else {
        upstream = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
          body: JSON.stringify(payload),
        });
      }
    } catch { return errorResponse('Failed to reach OpenAI', 502); }

    if (!upstream.ok) {
      const status = upstream.status;
      if (status === 429) return errorResponse('OpenAI rate limit reached. Try again shortly.', 429);
      if (status === 401) return errorResponse('OpenAI API key is invalid.', 401);
      return errorResponse(`OpenAI returned an error (${status}). Please try again.`, status);
    }
  } else {
    const apiKey = process.env.ANACHAT_API_KEY;
    const baseUrl = process.env.ANACHAT_BASE_URL;
    if (!apiKey || !baseUrl) return errorResponse('API configuration missing', 500);
    try {
      upstream = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(payload),
      });
    } catch { return errorResponse('Failed to reach upstream model', 502); }

    if (!upstream.ok) {
      const status = upstream.status;
      const errBody = await upstream.text().catch(() => '');
      const detail = errBody.slice(0, 300);
      if (status === 502 || status === 503 || status === 504)
        return errorResponse('The AI model server is currently offline. Please try again later.', status);
      return errorResponse(`Server error (${status}): ${detail}`, status);
    }
  }

  let responseBody: ReadableStream<Uint8Array> | null = upstream.body;
  if (useResponsesApi) responseBody = transformResponsesStream(upstream.body!);
  else if (isThinkingModel) responseBody = stripThinkingStream(upstream.body!);

  return new Response(responseBody, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-RateLimit-Remaining': String(remaining),
      ...SECURITY_HEADERS,
    },
  });
}
