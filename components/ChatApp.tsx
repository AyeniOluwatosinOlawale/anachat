'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = 'chat' | 'image';
type Model = 'phi-4' | 'qwen';
type Role = 'user' | 'assistant';

interface Message {
  id: string;
  role: Role;
  content: string;
  imageUrl?: string;
  isStreaming?: boolean;
}

interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  model: Model;
  createdAt: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  return Math.random().toString(36).slice(2, 11);
}

function getTitle(messages: Message[]): string {
  const first = messages.find((m) => m.role === 'user');
  if (!first) return 'New Chat';
  return first.content.slice(0, 40) + (first.content.length > 40 ? '…' : '');
}

// ─── Text Renderer (no external markdown lib) ─────────────────────────────────

function renderText(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Split by code fences first
  const parts = text.split(/(```[\s\S]*?```)/g);

  parts.forEach((part, i) => {
    if (part.startsWith('```')) {
      const lines = part.slice(3, -3).split('\n');
      const lang = lines[0]?.trim() || '';
      const code = lines.slice(lang ? 1 : 0).join('\n');
      nodes.push(
        <pre key={i}>
          {lang && (
            <div
              style={{
                fontSize: '0.7rem',
                color: '#888',
                marginBottom: 6,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {lang}
            </div>
          )}
          <code>{code}</code>
        </pre>
      );
    } else {
      // Process inline: bold, italic, inline code, line breaks
      const lines = part.split('\n');
      lines.forEach((line, li) => {
        const segments = parseInline(line);
        nodes.push(
          <span key={`${i}-${li}`}>
            {segments}
            {li < lines.length - 1 && '\n'}
          </span>
        );
      });
    }
  });

  return nodes;
}

function parseInline(text: string): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  // Regex to match **bold**, *italic*, `code`
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      result.push(text.slice(last, match.index));
    }
    if (match[2]) {
      result.push(<strong key={match.index}>{match[2]}</strong>);
    } else if (match[3]) {
      result.push(<em key={match.index}>{match[3]}</em>);
    } else if (match[4]) {
      result.push(<code key={match.index}>{match[4]}</code>);
    }
    last = match.index + match[0].length;
  }

  if (last < text.length) {
    result.push(text.slice(last));
  }

  return result;
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  );
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 18,
        height: 18,
        border: '2px solid #444',
        borderTopColor: '#7c3aed',
        borderRadius: '50%',
        animation: 'spin 0.7s linear infinite',
      }}
    />
  );
}

// ─── Quick Action Suggestions ─────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { label: 'Explain quantum computing', mode: 'chat' as Mode },
  { label: 'Write a Python web scraper', mode: 'chat' as Mode },
  { label: 'Generate a futuristic city image', mode: 'image' as Mode },
  { label: 'Summarize the latest AI trends', mode: 'chat' as Mode },
];

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ChatApp() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [model, setModel] = useState<Model>('phi-4');
  const [mode, setMode] = useState<Mode>('chat');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeConv = conversations.find((c) => c.id === activeId) ?? null;
  const messages = activeConv?.messages ?? [];

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [input]);

  // ─── Conversation management ───────────────────────────────────────────────

  const createNewChat = useCallback(() => {
    const id = generateId();
    const conv: Conversation = {
      id,
      title: 'New Chat',
      messages: [],
      model,
      createdAt: Date.now(),
    };
    setConversations((prev) => [conv, ...prev]);
    setActiveId(id);
    setInput('');
    setMode('chat');
  }, [model]);

  const updateConversation = useCallback(
    (id: string, updater: (c: Conversation) => Conversation) => {
      setConversations((prev) => prev.map((c) => (c.id === id ? updater(c) : c)));
    },
    []
  );

  // ─── Chat send ─────────────────────────────────────────────────────────────

  const sendChat = useCallback(
    async (convId: string, allMessages: Message[], userMsg: Message) => {
      const apiMessages = allMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const placeholderId = generateId();
      const placeholder: Message = {
        id: placeholderId,
        role: 'assistant',
        content: '',
        isStreaming: true,
      };

      updateConversation(convId, (c) => ({
        ...c,
        messages: [...c.messages, userMsg, placeholder],
      }));

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: ctrl.signal,
          body: JSON.stringify({ model, messages: apiMessages, stream: true }),
        });

        if (!res.ok || !res.body) {
          const err = await res.text();
          updateConversation(convId, (c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.id === placeholderId
                ? { ...m, content: `Error: ${err}`, isStreaming: false }
                : m
            ),
          }));
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') break;

            try {
              const parsed = JSON.parse(data);
              const delta = parsed?.choices?.[0]?.delta?.content ?? '';
              if (delta) {
                accumulated += delta;
                const snap = accumulated;
                updateConversation(convId, (c) => ({
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === placeholderId ? { ...m, content: snap } : m
                  ),
                }));
              }
            } catch {
              // ignore parse errors on malformed chunks
            }
          }
        }

        // Finalise
        updateConversation(convId, (c) => {
          const updated = c.messages.map((m) =>
            m.id === placeholderId ? { ...m, isStreaming: false } : m
          );
          return { ...c, messages: updated, title: getTitle(updated) };
        });
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          updateConversation(convId, (c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.id === placeholderId ? { ...m, isStreaming: false } : m
            ),
          }));
          return;
        }
        const msg = err instanceof Error ? err.message : 'Unknown error';
        updateConversation(convId, (c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === placeholderId
              ? { ...m, content: `Error: ${msg}`, isStreaming: false }
              : m
          ),
        }));
      } finally {
        abortRef.current = null;
        setLoading(false);
      }
    },
    [model, updateConversation]
  );

  // ─── Image generation ──────────────────────────────────────────────────────

  const sendImage = useCallback(
    async (convId: string, userMsg: Message) => {
      const placeholderId = generateId();
      const placeholder: Message = {
        id: placeholderId,
        role: 'assistant',
        content: '',
        isStreaming: true,
      };

      updateConversation(convId, (c) => ({
        ...c,
        messages: [...c.messages, userMsg, placeholder],
      }));

      try {
        const res = await fetch('/api/image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: userMsg.content, model, n: 1 }),
        });

        const data = await res.json();

        if (!res.ok) {
          const errMsg =
            (data as { error?: string })?.error ??
            `Image generation failed (${res.status})`;
          updateConversation(convId, (c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.id === placeholderId
                ? { ...m, content: `⚠️ ${errMsg}`, isStreaming: false }
                : m
            ),
          }));
          return;
        }

        const imageUrl: string =
          data?.data?.[0]?.url ??
          data?.data?.[0]?.b64_json ??
          data?.url ??
          '';

        const content = imageUrl ? '' : 'No image URL returned from the API.';

        updateConversation(convId, (c) => {
          const updated = c.messages.map((m) =>
            m.id === placeholderId
              ? { ...m, content, imageUrl: imageUrl || undefined, isStreaming: false }
              : m
          );
          return { ...c, messages: updated, title: getTitle(updated) };
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        updateConversation(convId, (c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === placeholderId
              ? { ...m, content: `Error: ${msg}`, isStreaming: false }
              : m
          ),
        }));
      } finally {
        setLoading(false);
      }
    },
    [model, updateConversation]
  );

  // ─── Submit handler ────────────────────────────────────────────────────────

  const handleSubmit = useCallback(
    async (text?: string, overrideMode?: Mode) => {
      const prompt = (text ?? input).trim();
      if (!prompt || loading) return;

      const sendMode = overrideMode ?? mode;

      setInput('');
      setLoading(true);

      // Ensure there is an active conversation
      let convId = activeId;
      if (!convId) {
        const id = generateId();
        const conv: Conversation = {
          id,
          title: 'New Chat',
          messages: [],
          model,
          createdAt: Date.now(),
        };
        setConversations((prev) => [conv, ...prev]);
        setActiveId(id);
        convId = id;
      }

      const userMsg: Message = { id: generateId(), role: 'user', content: prompt };

      const currentMessages =
        conversations.find((c) => c.id === convId)?.messages ?? [];

      if (sendMode === 'image') {
        await sendImage(convId, userMsg);
      } else {
        await sendChat(convId, [...currentMessages, { ...userMsg }], userMsg);
      }
    },
    [input, loading, mode, activeId, model, conversations, sendChat, sendImage]
  );

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        background: '#0f0f0f',
        color: '#ededed',
        overflow: 'hidden',
      }}
    >
      {/* ─── Sidebar ─────────────────────────────────────────────────────── */}
      {sidebarOpen && (
        <aside
          style={{
            width: 260,
            minWidth: 260,
            background: '#1a1a1a',
            borderRight: '1px solid #2a2a2a',
            display: 'flex',
            flexDirection: 'column',
            padding: '16px 0',
            overflowY: 'auto',
          }}
        >
          {/* Logo */}
          <div style={{ padding: '0 16px 16px', borderBottom: '1px solid #2a2a2a' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 14 }}>
              <span style={{ fontWeight: 800, fontSize: 20, color: '#7c3aed' }}>Ana</span>
              <span style={{ fontWeight: 700, fontSize: 20, color: '#ededed' }}>Chat</span>
            </div>
            <button
              onClick={createNewChat}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 14px',
                background: '#7c3aed',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 600,
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => ((e.target as HTMLButtonElement).style.background = '#6d28d9')}
              onMouseLeave={(e) => ((e.target as HTMLButtonElement).style.background = '#7c3aed')}
            >
              <PlusIcon />
              New Chat
            </button>
          </div>

          {/* Conversation list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
            {conversations.length === 0 ? (
              <p style={{ padding: '12px 16px', color: '#555', fontSize: 13 }}>No chats yet</p>
            ) : (
              conversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => setActiveId(conv.id)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 16px',
                    background: conv.id === activeId ? '#242424' : 'transparent',
                    border: 'none',
                    borderRadius: 0,
                    cursor: 'pointer',
                    color: conv.id === activeId ? '#ededed' : '#aaa',
                    fontSize: 13,
                    lineHeight: 1.4,
                    borderLeft: conv.id === activeId ? '2px solid #7c3aed' : '2px solid transparent',
                    transition: 'all 0.15s',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                  }}
                  onMouseEnter={(e) => {
                    if (conv.id !== activeId)
                      (e.currentTarget as HTMLButtonElement).style.background = '#1f1f1f';
                  }}
                  onMouseLeave={(e) => {
                    if (conv.id !== activeId)
                      (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                  }}
                >
                  {conv.title}
                </button>
              ))
            )}
          </div>
        </aside>
      )}

      {/* ─── Main area ───────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Top bar */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 20px',
            borderBottom: '1px solid #2a2a2a',
            background: '#0f0f0f',
            flexShrink: 0,
          }}
        >
          {/* Sidebar toggle */}
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            style={{
              background: 'none',
              border: '1px solid #2a2a2a',
              color: '#888',
              borderRadius: 6,
              padding: '5px 8px',
              cursor: 'pointer',
              fontSize: 16,
              lineHeight: 1,
            }}
            title="Toggle sidebar"
          >
            ☰
          </button>

          {/* Title (when sidebar hidden) */}
          {!sidebarOpen && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontWeight: 800, fontSize: 18, color: '#7c3aed' }}>Ana</span>
              <span style={{ fontWeight: 700, fontSize: 18, color: '#ededed' }}>Chat</span>
            </div>
          )}

          <div style={{ flex: 1 }} />

          {/* Mode toggle */}
          <div
            style={{
              display: 'flex',
              background: '#1a1a1a',
              border: '1px solid #2a2a2a',
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            {(['chat', 'image'] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '7px 14px',
                  background: mode === m ? '#7c3aed' : 'transparent',
                  color: mode === m ? '#fff' : '#888',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                  transition: 'all 0.15s',
                }}
              >
                {m === 'chat' ? <ChatIcon /> : <ImageIcon />}
                {m === 'chat' ? 'Chat' : 'Image'}
              </button>
            ))}
          </div>

          {/* Model selector */}
          <select
            value={model}
            onChange={(e) => setModel(e.target.value as Model)}
            style={{
              background: '#1a1a1a',
              color: '#ededed',
              border: '1px solid #2a2a2a',
              borderRadius: 8,
              padding: '7px 12px',
              fontSize: 13,
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            <option value="phi-4">phi-4</option>
            <option value="qwen">qwen</option>
          </select>
        </header>

        {/* Messages area */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: messages.length === 0 ? 0 : '24px 20px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {messages.length === 0 ? (
            // Empty state
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 32,
                padding: 40,
              }}
            >
              <div style={{ textAlign: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginBottom: 12 }}>
                  <span style={{ fontWeight: 800, fontSize: 36, color: '#7c3aed' }}>Ana</span>
                  <span style={{ fontWeight: 700, fontSize: 36, color: '#ededed' }}>Chat</span>
                </div>
                <p style={{ color: '#888', fontSize: 18, margin: 0 }}>How can I help you today?</p>
              </div>

              {/* Quick actions */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: 12,
                  maxWidth: 560,
                  width: '100%',
                }}
              >
                {QUICK_ACTIONS.map((action, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setMode(action.mode);
                      handleSubmit(action.label, action.mode);
                    }}
                    style={{
                      background: '#1e1e1e',
                      border: '1px solid #2a2a2a',
                      borderRadius: 10,
                      padding: '14px 16px',
                      color: '#ccc',
                      fontSize: 13,
                      cursor: 'pointer',
                      textAlign: 'left',
                      lineHeight: 1.5,
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = '#7c3aed';
                      (e.currentTarget as HTMLButtonElement).style.color = '#ededed';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = '#2a2a2a';
                      (e.currentTarget as HTMLButtonElement).style.color = '#ccc';
                    }}
                  >
                    <span style={{ marginRight: 6 }}>{action.mode === 'image' ? '🖼️' : '💬'}</span>
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ maxWidth: 760, width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input area */}
        <div
          style={{
            borderTop: '1px solid #2a2a2a',
            padding: '16px 20px',
            background: '#0f0f0f',
            flexShrink: 0,
          }}
        >
          <div style={{ maxWidth: 760, margin: '0 auto' }}>
            {/* Mode badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  background: mode === 'image' ? '#1a0a2e' : '#1a1a2e',
                  color: mode === 'image' ? '#c084fc' : '#818cf8',
                  border: `1px solid ${mode === 'image' ? '#6d28d9' : '#3730a3'}`,
                  borderRadius: 20,
                  padding: '3px 10px',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {mode === 'image' ? <ImageIcon /> : <ChatIcon />}
                {mode === 'image' ? 'Image Generation' : 'Chat Mode'}
              </span>
              <span style={{ color: '#555', fontSize: 12 }}>
                {model}
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: 10,
                background: '#1e1e1e',
                border: '1px solid #2a2a2a',
                borderRadius: 14,
                padding: '10px 14px',
              }}
            >
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  mode === 'image'
                    ? 'Describe the image you want to generate…'
                    : 'Message AnaChat… (Shift+Enter for newline)'
                }
                rows={1}
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: '#ededed',
                  fontSize: 15,
                  lineHeight: 1.6,
                  resize: 'none',
                  maxHeight: 200,
                  overflowY: 'auto',
                  fontFamily: 'inherit',
                  padding: 0,
                }}
              />
              <button
                onClick={loading ? handleStop : () => handleSubmit()}
                disabled={!input.trim() && !loading}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  border: 'none',
                  background:
                    loading
                      ? '#dc2626'
                      : !input.trim()
                      ? '#2a2a2a'
                      : '#7c3aed',
                  color: !input.trim() && !loading ? '#555' : '#fff',
                  cursor: !input.trim() && !loading ? 'default' : 'pointer',
                  transition: 'background 0.15s',
                  flexShrink: 0,
                }}
              >
                {loading ? <StopIcon /> : <SendIcon />}
              </button>
            </div>
            <p style={{ textAlign: 'center', color: '#444', fontSize: 11, margin: '8px 0 0' }}>
              AnaChat may produce inaccurate information. Verify important details.
            </p>
          </div>
        </div>
      </div>

      {/* Global keyframes */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

// ─── MessageBubble ─────────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div
          style={{
            maxWidth: '75%',
            background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
            color: '#fff',
            borderRadius: '18px 18px 4px 18px',
            padding: '12px 16px',
            fontSize: 15,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {message.content}
        </div>
      </div>
    );
  }

  // Assistant
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      {/* Avatar */}
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          fontSize: 13,
          fontWeight: 800,
          color: '#fff',
        }}
      >
        A
      </div>

      <div
        style={{
          background: '#1e1e1e',
          border: '1px solid #2a2a2a',
          borderRadius: '4px 18px 18px 18px',
          padding: '12px 16px',
          fontSize: 15,
          lineHeight: 1.7,
          color: '#ededed',
          maxWidth: 'calc(100% - 46px)',
          wordBreak: 'break-word',
        }}
      >
        {message.isStreaming && !message.content && !message.imageUrl ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '2px 0' }}>
            <Spinner />
            <span style={{ color: '#666', fontSize: 13 }}>Generating…</span>
          </div>
        ) : message.imageUrl ? (
          <div>
            {message.content && (
              <p style={{ margin: '0 0 10px', color: '#888', fontSize: 13 }}>{message.content}</p>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={message.imageUrl}
              alt="Generated image"
              style={{
                maxWidth: '100%',
                borderRadius: 10,
                border: '1px solid #2a2a2a',
                display: 'block',
              }}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
        ) : (
          <div>
            {renderText(message.content)}
            {message.isStreaming && (
              <span
                style={{
                  display: 'inline-block',
                  width: 2,
                  height: 16,
                  background: '#7c3aed',
                  marginLeft: 2,
                  animation: 'pulse 1s ease-in-out infinite',
                  verticalAlign: 'text-bottom',
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
