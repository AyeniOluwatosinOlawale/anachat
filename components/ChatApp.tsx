'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = 'chat' | 'image';
type Model = 'phi-4' | 'qwen';
type Role = 'user' | 'assistant';
type ApiRole = 'user' | 'assistant' | 'system';

interface Message {
  id: string;
  role: Role;
  content: string;
  imageUrl?: string;
  isStreaming?: boolean;
  isSearching?: boolean;
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

// ─── Auto-detect queries that need live web data ──────────────────────────────

// Queries that are clearly self-contained (no web needed even if factual-sounding)
const SKIP_RE = /^(write|draft|compose|create a|generate a|make a|give me a|tell me a|explain how to|how do i|how to|what is the difference between|define |calculate |convert |translate |fix (this|my)|debug|refactor|code |implement |build |poem|story|joke|essay|recipe|hello|hi|hey|good morning|good afternoon|good evening|good night|how are you|how're you|what's up|sup |yo |thanks|thank you|ok|okay|sure|nice|cool|great|awesome|lol|haha|bye|goodbye|see you)\b/i;

// Strong signal: explicitly time-sensitive
const STRONG_RE = /\b(current(ly)?|latest|recent(ly)?|today|tonight|right now|this (week|month|year)|2024|2025|2026|breaking|live|just (announced?|happened|released?)|update[ds]?|news|governor|president|prime minister|minister|senator|congressman|parliament|ceo|chairman|founder|head of|leader of|election|vote|result|score|standings|ranking|price|cost|worth|stock|market|crypto|bitcoin|ethereum|weather|forecast|temperature|rate|exchange rate|inflation|gdp|population|covid|coronavirus|war|conflict|attack|disaster|earthquake|flood|fire|arrest|death|born|died|killed|appointed|resigned|retired|won|lost|launched|released|announced)\b/i;

// Factual question starters — likely need real-world data
const FACTUAL_Q_RE = /^(who (is|are|was|were)|what (is|are|was|were|happened|did)|when (is|was|did|will)|where (is|are|was|were)|which (is|are|was|were)|how (many|much|old|long|tall|big|far)|is (there|it|he|she|they)|are (there|they)|did |does |has |have |will |was |were )/i;

function needsLiveData(query: string): boolean {
  const q = query.trim();
  if (q.length < 12) return false;             // too short to be a factual query
  if (SKIP_RE.test(q)) return false;           // conversational or clearly non-factual
  if (STRONG_RE.test(q)) return true;          // explicit recency signal
  if (FACTUAL_Q_RE.test(q)) return true;       // factual question about the world
  return false;
}

// ─── Responsive hook ──────────────────────────────────────────────────────────

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

// ─── Text Renderer ────────────────────────────────────────────────────────────

function renderText(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const parts = text.split(/(```[\s\S]*?```)/g);

  parts.forEach((part, i) => {
    if (part.startsWith('```')) {
      const lines = part.slice(3, -3).split('\n');
      const lang = lines[0]?.trim() || '';
      const code = lines.slice(lang ? 1 : 0).join('\n');
      nodes.push(
        <pre key={i}>
          {lang && (
            <div style={{ fontSize: '0.7rem', color: '#888', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {lang}
            </div>
          )}
          <code>{code}</code>
        </pre>
      );
    } else {
      const lines = part.split('\n');
      lines.forEach((line, li) => {
        nodes.push(
          <span key={`${i}-${li}`}>
            {parseInline(line)}
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
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) result.push(text.slice(last, match.index));
    if (match[2]) result.push(<strong key={match.index}>{match[2]}</strong>);
    else if (match[3]) result.push(<em key={match.index}>{match[3]}</em>);
    else if (match[4]) result.push(<code key={match.index}>{match[4]}</code>);
    last = match.index + match[0].length;
  }
  if (last < text.length) result.push(text.slice(last));
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

function ImageIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

function ChatIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function GlobeIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function Spinner() {
  return (
    <span style={{ display: 'inline-block', width: 18, height: 18, border: '2px solid #444', borderTopColor: '#7c3aed', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
  );
}

// ─── Quick Actions ────────────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { label: 'Explain quantum computing', mode: 'chat' as Mode, emoji: '🧠' },
  { label: 'Write a Python web scraper', mode: 'chat' as Mode, emoji: '🐍' },
  { label: 'Generate a futuristic city image', mode: 'image' as Mode, emoji: '🖼️' },
  { label: 'Summarize the latest AI trends', mode: 'chat' as Mode, emoji: '🤖' },
];

// ─── Logo ─────────────────────────────────────────────────────────────────────

function Logo({ size = 20 }: { size?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      <span style={{ fontWeight: 800, fontSize: size, color: '#7c3aed', lineHeight: 1 }}>Ana</span>
      <span style={{ fontWeight: 700, fontSize: size, color: '#ededed', lineHeight: 1 }}>Chat</span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ChatApp() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [model, setModel] = useState<Model>('qwen');
  const [mode, setMode] = useState<Mode>('chat');
  const [input, setInput] = useState('');
  const [webSearch, setWebSearch] = useState(true);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isMobile = useIsMobile();

  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeConv = conversations.find((c) => c.id === activeId) ?? null;
  const messages = activeConv?.messages ?? [];

  // On desktop, sidebar starts open
  useEffect(() => {
    if (!isMobile) setSidebarOpen(true);
    else setSidebarOpen(false);
  }, [isMobile]);

  // Lock body scroll when mobile drawer is open
  useEffect(() => {
    if (isMobile && sidebarOpen) {
      document.body.classList.add('drawer-open');
    } else {
      document.body.classList.remove('drawer-open');
    }
    return () => document.body.classList.remove('drawer-open');
  }, [isMobile, sidebarOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, isMobile ? 120 : 200) + 'px';
  }, [input, isMobile]);

  // ─── Conversation management ───────────────────────────────────────────────

  const createNewChat = useCallback(() => {
    const id = generateId();
    setConversations((prev) => [{ id, title: 'New Chat', messages: [], model, createdAt: Date.now() }, ...prev]);
    setActiveId(id);
    setInput('');
    setMode('chat');
    if (isMobile) setSidebarOpen(false);
  }, [model, isMobile]);

  const selectConversation = useCallback((id: string) => {
    setActiveId(id);
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  const updateConversation = useCallback((id: string, updater: (c: Conversation) => Conversation) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? updater(c) : c)));
  }, []);

  // ─── Chat send ─────────────────────────────────────────────────────────────

  const sendChat = useCallback(async (convId: string, allMessages: Message[], userMsg: Message) => {
    let apiMessages: { role: ApiRole; content: string }[] = allMessages.map((m) => ({ role: m.role, content: m.content }));

    // Web search: run when toggle is ON or query is auto-detected as needing live data
    const shouldSearch = webSearch || needsLiveData(userMsg.content);
    let directAnswer = ''; // filled when search returns a clean topFact

    if (shouldSearch) {
      setSearching(true);
      try {
        const res = await fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: userMsg.content }),
        });
        const data = await res.json() as {
          results?: { title: string; url: string; snippet?: string; content?: string }[];
          topFact?: string;
        };

        const topFact = (data.topFact ?? '').trim();

        if (topFact.length > 20) {
          // We have a verified fact — skip the model entirely
          directAnswer = topFact;
        } else if (data.results && data.results.length > 0) {
          // No clean topFact — fall back to model with supporting context
          const today = new Date().toISOString().split('T')[0];
          const supporting = (data.results)
            .slice(0, 3)
            .map((r) => {
              const body = (r.content && r.content.length > 80 ? r.content.slice(0, 500) : r.snippet ?? '').trim();
              return body ? `${r.title}: ${body}` : null;
            })
            .filter(Boolean)
            .join('\n\n');

          apiMessages = [{
            role: 'system' as const,
            content: `Today is ${today}. Answer using only these search results in one direct sentence:\n\n${supporting}`,
          }, ...apiMessages];
        }
      } catch { /* continue without search */ } finally {
        setSearching(false);
      }
    }

    const placeholderId = generateId();
    const placeholder: Message = { id: placeholderId, role: 'assistant', content: '', isStreaming: true, isSearching: shouldSearch };

    updateConversation(convId, (c) => ({ ...c, messages: [...c.messages, userMsg, placeholder] }));

    // ── Direct answer from search: skip the model ──────────────────────────
    if (directAnswer) {
      updateConversation(convId, (c) => {
        const updated = c.messages.map((m) =>
          m.id === placeholderId ? { ...m, content: directAnswer, isStreaming: false } : m
        );
        return { ...c, messages: updated, title: getTitle(updated) };
      });
      setLoading(false);
      return;
    }

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
          messages: c.messages.map((m) => m.id === placeholderId ? { ...m, content: `⚠️ ${err}`, isStreaming: false } : m),
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
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') break;
          try {
            const delta = JSON.parse(data)?.choices?.[0]?.delta?.content ?? '';
            if (delta) {
              accumulated += delta;
              const snap = accumulated;
              updateConversation(convId, (c) => ({
                ...c,
                messages: c.messages.map((m) => m.id === placeholderId ? { ...m, content: snap } : m),
              }));
            }
          } catch { /* ignore malformed chunks */ }
        }
      }

      updateConversation(convId, (c) => {
        const updated = c.messages.map((m) => m.id === placeholderId ? { ...m, isStreaming: false } : m);
        return { ...c, messages: updated, title: getTitle(updated) };
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        updateConversation(convId, (c) => ({
          ...c,
          messages: c.messages.map((m) => m.id === placeholderId ? { ...m, isStreaming: false } : m),
        }));
        return;
      }
      const msg = err instanceof Error ? err.message : 'Unknown error';
      updateConversation(convId, (c) => ({
        ...c,
        messages: c.messages.map((m) => m.id === placeholderId ? { ...m, content: `⚠️ ${msg}`, isStreaming: false } : m),
      }));
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  }, [model, webSearch, updateConversation]);

  // ─── Image generation ──────────────────────────────────────────────────────

  const sendImage = useCallback(async (convId: string, userMsg: Message) => {
    const placeholderId = generateId();
    const placeholder: Message = { id: placeholderId, role: 'assistant', content: '', isStreaming: true };

    updateConversation(convId, (c) => ({ ...c, messages: [...c.messages, userMsg, placeholder] }));

    try {
      const imageCtrl = new AbortController();
      const imageTimeout = setTimeout(() => imageCtrl.abort(), 30_000);

      let res: Response;
      try {
        res = await fetch('/api/image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: userMsg.content, size: '1024x1024', steps: 4 }),
          signal: imageCtrl.signal,
        });
      } finally {
        clearTimeout(imageTimeout);
      }

      let data: unknown;
      try { data = await res.json(); } catch { data = {}; }

      if (!res.ok) {
        const errMsg =
          (data as { error?: string })?.error ??
          (res.status >= 502
            ? 'Image service is offline. Please try again later.'
            : `Image generation failed (${res.status})`);
        updateConversation(convId, (c) => ({
          ...c,
          messages: c.messages.map((m) => m.id === placeholderId ? { ...m, content: `⚠️ ${errMsg}`, isStreaming: false } : m),
        }));
        return;
      }

      const d = data as { data?: { url?: string; b64_json?: string }[]; url?: string };
      const imageUrl: string = d?.data?.[0]?.url ?? d?.data?.[0]?.b64_json ?? d?.url ?? '';
      const content = imageUrl ? '' : 'No image URL returned from the API.';

      updateConversation(convId, (c) => {
        const updated = c.messages.map((m) =>
          m.id === placeholderId ? { ...m, content, imageUrl: imageUrl || undefined, isStreaming: false } : m
        );
        return { ...c, messages: updated, title: getTitle(updated) };
      });
    } catch (err: unknown) {
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      const msg = isTimeout ? 'Image request timed out. The service may be offline.' : (err instanceof Error ? err.message : 'Unknown error');
      updateConversation(convId, (c) => ({
        ...c,
        messages: c.messages.map((m) => m.id === placeholderId ? { ...m, content: `⚠️ ${msg}`, isStreaming: false } : m),
      }));
    } finally {
      setLoading(false);
    }
  }, [updateConversation]);

  // ─── Submit handler ────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async (text?: string, overrideMode?: Mode) => {
    const prompt = (text ?? input).trim();
    if (!prompt || loading) return;

    const sendMode = overrideMode ?? mode;
    setInput('');
    setLoading(true);

    let convId = activeId;
    if (!convId) {
      const id = generateId();
      const conv: Conversation = { id, title: 'New Chat', messages: [], model, createdAt: Date.now() };
      setConversations((prev) => [conv, ...prev]);
      setActiveId(id);
      convId = id;
    }

    const userMsg: Message = { id: generateId(), role: 'user', content: prompt };
    const currentMessages = conversations.find((c) => c.id === convId)?.messages ?? [];

    if (sendMode === 'image') {
      await sendImage(convId, userMsg);
    } else {
      await sendChat(convId, [...currentMessages, userMsg], userMsg);
    }
  }, [input, loading, mode, activeId, model, conversations, sendChat, sendImage]);

  const handleStop = () => abortRef.current?.abort();

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !isMobile) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // ─── Sidebar content (shared between desktop + mobile drawer) ─────────────

  const sidebarContent = (
    <>
      {/* Logo + close button (mobile only) */}
      <div style={{ padding: '16px', borderBottom: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Logo size={22} />
        {isMobile && (
          <button
            onClick={() => setSidebarOpen(false)}
            style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: 8, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <CloseIcon />
          </button>
        )}
      </div>

      {/* New Chat button */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #2a2a2a' }}>
        <button
          onClick={createNewChat}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
          onMouseEnter={(e) => ((e.currentTarget).style.background = '#6d28d9')}
          onMouseLeave={(e) => ((e.currentTarget).style.background = '#7c3aed')}
        >
          <PlusIcon />
          New Chat
        </button>
      </div>

      {/* Mode toggle (mobile: shown in sidebar) */}
      {isMobile && (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #2a2a2a' }}>
          <p style={{ fontSize: 11, color: '#555', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Mode</p>
          <div style={{ display: 'flex', background: '#111', border: '1px solid #2a2a2a', borderRadius: 10, overflow: 'hidden' }}>
            {(['chat', 'image'] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setSidebarOpen(false); }}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 0', background: mode === m ? '#7c3aed' : 'transparent', color: mode === m ? '#fff' : '#888', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
              >
                {m === 'chat' ? <ChatIcon /> : <ImageIcon />}
                {m === 'chat' ? 'Chat' : 'Image'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Model selector (mobile: shown in sidebar) */}
      {isMobile && (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #2a2a2a' }}>
          <p style={{ fontSize: 11, color: '#555', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Model</p>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['phi-4', 'qwen'] as Model[]).map((m) => (
              <button
                key={m}
                onClick={() => setModel(m)}
                style={{ flex: 1, padding: '10px 0', background: model === m ? '#1a0a2e' : '#111', color: model === m ? '#c084fc' : '#888', border: `1px solid ${model === m ? '#6d28d9' : '#2a2a2a'}`, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Web search toggle (mobile sidebar) */}
      {isMobile && mode === 'chat' && (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #2a2a2a' }}>
          <p style={{ fontSize: 11, color: '#555', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Web Search</p>
          <button
            onClick={() => setWebSearch((v) => !v)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: webSearch ? '#052e16' : '#111', border: `1px solid ${webSearch ? '#16a34a' : '#2a2a2a'}`, borderRadius: 10, color: webSearch ? '#4ade80' : '#888', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <GlobeIcon size={15} />
              Search the web for latest info
            </span>
            <span style={{ width: 36, height: 20, borderRadius: 10, background: webSearch ? '#16a34a' : '#2a2a2a', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
              <span style={{ position: 'absolute', top: 2, left: webSearch ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
            </span>
          </button>
        </div>
      )}

      {/* Conversation history */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {conversations.length === 0 ? (
          <p style={{ padding: '12px 16px', color: '#444', fontSize: 13 }}>No chats yet</p>
        ) : (
          conversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => selectConversation(conv.id)}
              style={{ width: '100%', textAlign: 'left', padding: '11px 16px', background: conv.id === activeId ? '#242424' : 'transparent', border: 'none', cursor: 'pointer', color: conv.id === activeId ? '#ededed' : '#999', fontSize: 13, lineHeight: 1.4, borderLeft: `2px solid ${conv.id === activeId ? '#7c3aed' : 'transparent'}`, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', minHeight: 44 }}
              onMouseEnter={(e) => { if (conv.id !== activeId) (e.currentTarget).style.background = '#1f1f1f'; }}
              onMouseLeave={(e) => { if (conv.id !== activeId) (e.currentTarget).style.background = 'transparent'; }}
            >
              {conv.title}
            </button>
          ))
        )}
      </div>
    </>
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', height: '100dvh', background: '#0f0f0f', color: '#ededed', overflow: 'hidden', position: 'relative' }}>

      {/* ─── Desktop sidebar ───────────────────────────────────────────── */}
      {!isMobile && sidebarOpen && (
        <aside style={{ width: 260, minWidth: 260, background: '#1a1a1a', borderRight: '1px solid #2a2a2a', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          {sidebarContent}
        </aside>
      )}

      {/* ─── Mobile drawer backdrop ────────────────────────────────────── */}
      {isMobile && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 40, animation: 'fadeIn 0.2s ease' }}
        />
      )}

      {/* ─── Mobile drawer ─────────────────────────────────────────────── */}
      {isMobile && (
        <aside
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            bottom: 0,
            width: 280,
            background: '#1a1a1a',
            borderRight: '1px solid #2a2a2a',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 50,
            transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
            transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
            overflowY: 'auto',
            paddingTop: 'env(safe-area-inset-top, 0px)',
          }}
        >
          {sidebarContent}
        </aside>
      )}

      {/* ─── Main area ─────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}>

        {/* Top bar */}
        <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: isMobile ? '10px 14px' : '12px 20px', borderBottom: '1px solid #2a2a2a', background: '#0f0f0f', flexShrink: 0, paddingTop: isMobile ? `calc(10px + env(safe-area-inset-top, 0px))` : '12px', minHeight: isMobile ? 56 : 60 }}>

          {/* Menu / sidebar toggle */}
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            style={{ background: 'none', border: '1px solid #2a2a2a', color: '#888', borderRadius: 8, padding: '6px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 38, minHeight: 38, flexShrink: 0 }}
            title="Toggle sidebar"
          >
            <MenuIcon />
          </button>

          {/* Logo (always visible when sidebar hidden, or on mobile) */}
          {(isMobile || !sidebarOpen) && (
            <Logo size={isMobile ? 18 : 20} />
          )}

          <div style={{ flex: 1 }} />

          {/* Mode toggle (desktop only) */}
          {!isMobile && (
            <div style={{ display: 'flex', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, overflow: 'hidden' }}>
              {(['chat', 'image'] as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: mode === m ? '#7c3aed' : 'transparent', color: mode === m ? '#fff' : '#888', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
                >
                  {m === 'chat' ? <ChatIcon /> : <ImageIcon />}
                  {m === 'chat' ? 'Chat' : 'Image'}
                </button>
              ))}
            </div>
          )}

          {/* Model selector (desktop only) */}
          {!isMobile && (
            <select
              value={model}
              onChange={(e) => setModel(e.target.value as Model)}
              style={{ background: '#1a1a1a', color: '#ededed', border: '1px solid #2a2a2a', borderRadius: 8, padding: '7px 12px', fontSize: 13, cursor: 'pointer', outline: 'none' }}
            >
              <option value="phi-4">phi-4</option>
              <option value="qwen">qwen</option>
            </select>
          )}

          {/* Mobile: compact mode badge */}
          {isMobile && (
            <button
              onClick={() => setSidebarOpen(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 20, padding: '5px 10px', color: '#c084fc', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              {mode === 'image' ? <ImageIcon size={13} /> : <ChatIcon size={13} />}
              {model}
            </button>
          )}
        </header>

        {/* Messages area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: messages.length === 0 ? 0 : isMobile ? '16px 12px' : '24px 20px', display: 'flex', flexDirection: 'column' }}>
          {messages.length === 0 ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: isMobile ? 24 : 32, padding: isMobile ? '24px 16px' : 40 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginBottom: 10 }}>
                  <span style={{ fontWeight: 800, fontSize: isMobile ? 28 : 36, color: '#7c3aed' }}>Ana</span>
                  <span style={{ fontWeight: 700, fontSize: isMobile ? 28 : 36, color: '#ededed' }}>Chat</span>
                </div>
                <p style={{ color: '#888', fontSize: isMobile ? 15 : 18, margin: 0 }}>How can I help you today?</p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: 10, maxWidth: isMobile ? '100%' : 560, width: '100%' }}>
                {QUICK_ACTIONS.map((action, i) => (
                  <button
                    key={i}
                    onClick={() => { setMode(action.mode); handleSubmit(action.label, action.mode); }}
                    style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 12, padding: isMobile ? '14px 14px' : '14px 16px', color: '#ccc', fontSize: 13, cursor: 'pointer', textAlign: 'left', lineHeight: 1.5, minHeight: 52, display: 'flex', alignItems: 'center', gap: 10 }}
                    onMouseEnter={(e) => { (e.currentTarget).style.borderColor = '#7c3aed'; (e.currentTarget).style.color = '#ededed'; }}
                    onMouseLeave={(e) => { (e.currentTarget).style.borderColor = '#2a2a2a'; (e.currentTarget).style.color = '#ccc'; }}
                  >
                    <span style={{ fontSize: 18 }}>{action.emoji}</span>
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ maxWidth: isMobile ? '100%' : 760, width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: isMobile ? 16 : 20 }}>
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} isMobile={isMobile} />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input area */}
        <div style={{ borderTop: '1px solid #2a2a2a', padding: isMobile ? '10px 12px' : '16px 20px', background: '#0f0f0f', flexShrink: 0, paddingBottom: `calc(${isMobile ? '10px' : '16px'} + env(safe-area-inset-bottom, 0px))` }}>
          <div style={{ maxWidth: isMobile ? '100%' : 760, margin: '0 auto' }}>
            {/* Mode badge + web search toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: mode === 'image' ? '#1a0a2e' : '#1a1a2e', color: mode === 'image' ? '#c084fc' : '#818cf8', border: `1px solid ${mode === 'image' ? '#6d28d9' : '#3730a3'}`, borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 600 }}>
                {mode === 'image' ? <ImageIcon size={11} /> : <ChatIcon size={11} />}
                {mode === 'image' ? 'Image Generation' : 'Chat'}
              </span>
              {!isMobile && <span style={{ color: '#444', fontSize: 11 }}>{model}</span>}

              {/* Web search toggle — only relevant in chat mode */}
              {mode === 'chat' && (
                <button
                  onClick={() => setWebSearch((v) => !v)}
                  title={webSearch ? 'Web search ON — click to disable' : 'Enable web search for latest info'}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, border: `1px solid ${webSearch ? '#16a34a' : '#2a2a2a'}`, background: webSearch ? '#052e16' : 'transparent', color: webSearch ? '#4ade80' : '#555', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                >
                  <GlobeIcon size={11} />
                  {searching ? 'Searching…' : 'Web Search'}
                  {webSearch && !searching && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80', display: 'inline-block' }} />}
                </button>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: isMobile ? 16 : 14, padding: isMobile ? '10px 12px' : '10px 14px' }}>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={mode === 'image' ? 'Describe the image…' : 'Message AnaChat…'}
                rows={1}
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#ededed', fontSize: isMobile ? 16 : 15, lineHeight: 1.6, resize: 'none', maxHeight: isMobile ? 120 : 200, overflowY: 'auto', fontFamily: 'inherit', padding: 0 }}
              />
              <button
                onClick={loading ? handleStop : () => handleSubmit()}
                disabled={!input.trim() && !loading}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: isMobile ? 42 : 38, height: isMobile ? 42 : 38, borderRadius: 12, border: 'none', background: loading ? '#dc2626' : !input.trim() ? '#2a2a2a' : '#7c3aed', color: !input.trim() && !loading ? '#555' : '#fff', cursor: !input.trim() && !loading ? 'default' : 'pointer', flexShrink: 0 }}
              >
                {loading ? <StopIcon /> : <SendIcon />}
              </button>
            </div>

          </div>
        </div>
      </div>

      {/* Global keyframes */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </div>
  );
}

// ─── MessageBubble ─────────────────────────────────────────────────────────────

function MessageBubble({ message, isMobile }: { message: Message; isMobile: boolean }) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ maxWidth: isMobile ? '88%' : '75%', background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', color: '#fff', borderRadius: '18px 18px 4px 18px', padding: isMobile ? '10px 14px' : '12px 16px', fontSize: isMobile ? 15 : 15, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: isMobile ? 10 : 12, alignItems: 'flex-start' }}>
      <div style={{ width: isMobile ? 30 : 34, height: isMobile ? 30 : 34, borderRadius: '50%', background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: isMobile ? 12 : 13, fontWeight: 800, color: '#fff' }}>
        A
      </div>
      <div style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: '4px 18px 18px 18px', padding: isMobile ? '10px 14px' : '12px 16px', fontSize: isMobile ? 14 : 15, lineHeight: 1.7, color: '#ededed', maxWidth: `calc(100% - ${isMobile ? 40 : 46}px)`, wordBreak: 'break-word' }}>
        {message.isStreaming && !message.content && !message.imageUrl ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Spinner />
            <span style={{ color: '#666', fontSize: 13 }}>
              {message.isSearching ? '🔍 Searching the web…' : 'Generating…'}
            </span>
          </div>
        ) : message.imageUrl ? (
          <div>
            {message.content && <p style={{ margin: '0 0 10px', color: '#888', fontSize: 13 }}>{message.content}</p>}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={message.imageUrl} alt="Generated image" style={{ maxWidth: '100%', borderRadius: 10, border: '1px solid #2a2a2a', display: 'block' }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
            <a
              href={message.imageUrl}
              download="anachat-image.png"
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10, padding: '7px 14px', background: '#1a1a2e', border: '1px solid #3730a3', borderRadius: 8, color: '#818cf8', fontSize: 13, fontWeight: 600, textDecoration: 'none', cursor: 'pointer' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = '#7c3aed'; (e.currentTarget as HTMLAnchorElement).style.color = '#fff'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = '#1a1a2e'; (e.currentTarget as HTMLAnchorElement).style.color = '#818cf8'; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download
            </a>
          </div>
        ) : (
          <div style={{ whiteSpace: 'pre-wrap' }}>
            {renderText(message.content)}
            {message.isStreaming && (
              <span style={{ display: 'inline-block', width: 2, height: 15, background: '#7c3aed', marginLeft: 2, animation: 'pulse 1s ease-in-out infinite', verticalAlign: 'text-bottom' }} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
