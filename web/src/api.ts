import type {
  Session,
  ChatMessage,
  SearchResult,
  RecallBudget,
  ThinkingEffort,
  Verbosity,
  SupportedModel,
  ThreadItem,
  ThreadProposal,
  NavigationLink,
  ChronologyEvent,
} from './types';

const API_BASE = ''; // relative URL, handled by Vite proxy in dev and FastAPI mount in prod

export interface HealthDetails {
  status: 'ok' | 'degraded' | 'offline';
  backend: string;
  hindsight: string;
  database: string;
}

export async function getHealthDetails(): Promise<HealthDetails> {
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) {
      return {
        status: 'offline',
        backend: 'unreachable',
        hindsight: 'unreachable',
        database: 'unreachable',
      };
    }
    const data = await res.json();
    return {
      status: data.status || 'ok',
      backend: data.backend || 'healthy',
      hindsight: data.hindsight || 'healthy',
      database: data.database || 'healthy',
    };
  } catch {
    return {
      status: 'offline',
      backend: 'unreachable',
      hindsight: 'unreachable',
      database: 'unreachable',
    };
  }
}

export async function checkHealth(): Promise<boolean> {
  const details = await getHealthDetails();
  return details.status === 'ok';
}

export async function listSessions(): Promise<Session[]> {
  const res = await fetch(`${API_BASE}/sessions`);
  if (!res.ok) throw new Error(`Failed to list sessions: ${res.status}`);
  return res.json();
}

export async function createSession(params?: {
  name?: string;
  recall_budget?: RecallBudget;
  thinking_effort?: ThinkingEffort;
  verbosity?: Verbosity;
  model?: SupportedModel;
}): Promise<Session> {
  const res = await fetch(`${API_BASE}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: params?.name || undefined,
      recall_budget: params?.recall_budget || 'medium',
      thinking_effort: params?.thinking_effort || 'medium',
      verbosity: params?.verbosity || 'low',
      model: params?.model || 'gpt-5.4-mini',
    }),
  });
  if (!res.ok) throw new Error(`Failed to create session: ${res.status}`);
  return res.json();
}

export async function updateSession(
  sessionId: string,
  updates: {
    name?: string;
    recall_budget?: RecallBudget;
    thinking_effort?: ThinkingEffort;
    verbosity?: Verbosity;
    model?: SupportedModel;
  }
): Promise<Session> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`Failed to update session: ${res.status}`);
  return res.json();
}

export async function deleteSession(sessionId: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}`, { method: 'DELETE' });
  return res.ok;
}

export async function truncateMessagesFrom(sessionId: string, fromMessageId: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/sessions/${sessionId}/messages?from_message_id=${encodeURIComponent(fromMessageId)}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getSessionMessages(sessionId: string): Promise<{ session: Session; messages: ChatMessage[] }> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}`);
  if (!res.ok) throw new Error(`Failed to load session ${sessionId}: ${res.status}`);
  const data = await res.json();
  return {
    session: data.session,
    messages: data.messages || [],
  };
}

export async function searchMessages(query: string): Promise<SearchResult[]> {
  if (!query.trim()) return [];
  const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query.trim())}`);
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  return res.json();
}

export interface StreamChatHandlers {
  onSessionRenamed?: (newName: string) => void;
  onStatus?: (text: string) => void;
  onThinking?: () => void;
  onReasoningDelta?: (text: string) => void;
  onAgenticStep?: (step: { step: string; message: string }) => void;
  onToolStart?: (tool: string, query?: string) => void;
  onToolDone?: (tool: string, result?: string) => void;
  onThreadProposal?: (proposal: ThreadProposal) => void;
  onDelta: (text: string) => void;
  onComplete: (data: {
    text: string;
    memory_status: string;
    usage: Record<string, any>;
    user_message_id?: string;
    assistant_message_id?: string;
    thread_proposal?: ThreadProposal;
  }) => void;
  onError: (error: string) => void;
}

export async function streamChatTurn(
  params: {
    sessionId: string;
    message: string;
    messageId?: string;
    recallBudget?: RecallBudget;
    thinkingEffort?: ThinkingEffort;
    verbosity?: Verbosity;
    model?: SupportedModel;
    isTemporary?: boolean;
  },
  handlers: StreamChatHandlers,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${API_BASE}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: params.sessionId,
      message: params.message,
      message_id: params.messageId,
      recall_budget: params.recallBudget,
      thinking_effort: params.thinkingEffort,
      verbosity: params.verbosity,
      model: params.model,
      is_temporary: params.isTemporary || false,
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`Chat stream request failed: ${res.status} ${res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let currentEvent = 'delta';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith('event: ')) {
          currentEvent = trimmed.substring(7).trim();
        } else if (trimmed.startsWith('data: ')) {
          const rawData = trimmed.substring(6).trim();
          try {
            const data = JSON.parse(rawData);

            if (currentEvent === 'session_renamed') {
              handlers.onSessionRenamed?.(data.name);
            } else if (currentEvent === 'status') {
              handlers.onStatus?.(data.text || '');
            } else if (currentEvent === 'agentic_step') {
              handlers.onAgenticStep?.(data);
            } else if (currentEvent === 'thinking') {
              handlers.onStatus?.('Thinking');
              handlers.onThinking?.();
            } else if (currentEvent === 'reasoning_delta') {
              handlers.onReasoningDelta?.(data.text || '');
            } else if (currentEvent === 'thread_proposal') {
              handlers.onThreadProposal?.(data);
            } else if (currentEvent === 'tool_start' || currentEvent === 'tool_call') {
              const toolName = data.tool || 'tool';
              if (toolName === 'tavily_search') {
                handlers.onStatus?.('Searching');
              } else if (toolName === 'consult_memory' || toolName === 'search_past_conversations') {
                handlers.onStatus?.('Searching past conversations');
              } else if (toolName === 'read_memory_doc') {
                handlers.onStatus?.('Reading memory');
              } else if (toolName === 'update_memory_section') {
                handlers.onStatus?.('Updating memory');
              } else if (toolName === 'create_memory_doc') {
                handlers.onStatus?.('Creating memory doc');
              } else if (toolName === 'read_mental_model') {
                handlers.onStatus?.('Fetching mental model');
              } else if (toolName === 'propose_side_chat') {
                handlers.onStatus?.('Proposing side chat');
              }
              handlers.onToolStart?.(toolName, data.query || '');
            } else if (currentEvent === 'tool_done' || currentEvent === 'tool_result') {
              handlers.onToolDone?.(data.tool || 'tool', data.result || '');
            } else if (currentEvent === 'delta') {
              handlers.onDelta(data.text || '');
            } else if (currentEvent === 'complete') {
              handlers.onComplete({
                text: data.text || '',
                memory_status: data.memory_status || 'ok',
                usage: data.usage || {},
                user_message_id: data.user_message_id,
                assistant_message_id: data.assistant_message_id,
                thread_proposal: data.thread_proposal,
              });
            } else if (currentEvent === 'error') {
              handlers.onError(data.error || 'Unknown error');
            }
          } catch {
            if (currentEvent === 'delta') {
              handlers.onDelta(rawData);
            }
          }
        }
      }
    }
  } catch (err: any) {
    if (signal?.aborted) {
      return;
    }
    handlers.onError(err.message || 'Stream interrupted');
  }
}

export interface MentalModelItem {
  id: string;
  content: string;
  is_ready: boolean;
}

export async function getMentalModels(): Promise<MentalModelItem[]> {
  const res = await fetch(`${API_BASE}/memory/mental-models`);
  if (!res.ok) throw new Error(`Failed to load mental models: ${res.status}`);
  const data = await res.json();
  return data.items || [];
}

export interface ReflectResponse {
  query: string;
  answer: string;
  citations: any[];
  status: string;
}

export async function reflectMemory(query: string, budget: string = 'mid'): Promise<ReflectResponse> {
  const res = await fetch(`${API_BASE}/memory/reflect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, budget }),
  });
  if (!res.ok) throw new Error(`Reflect failed: ${res.status}`);
  return res.json();
}

export interface VaultTreeItem {
  path: string;
  name: string;
  title: string;
  category: string;
  size_bytes: number;
  updated_at: string;
}

export interface ActivityLogEntry {
  timestamp: string;
  source: string;
  action: string;
  path: string;
  detail: string;
}

export async function getVaultTree(): Promise<VaultTreeItem[]> {
  const res = await fetch(`${API_BASE}/api/memory/tree`);
  if (!res.ok) throw new Error(`Failed to load vault tree: ${res.status}`);
  const data = await res.json();
  return data.tree || [];
}

export async function getVaultDoc(path: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/memory/doc?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error(`Failed to load doc: ${res.status}`);
  const data = await res.json();
  return data.content || '';
}

export async function saveVaultDoc(path: string, content: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/memory/doc`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content }),
  });
  return res.ok;
}

export async function getVaultActivity(limit: number = 50): Promise<ActivityLogEntry[]> {
  const res = await fetch(`${API_BASE}/api/memory/activity?limit=${limit}`);
  if (!res.ok) throw new Error(`Failed to load activity: ${res.status}`);
  const data = await res.json();
  return data.entries || [];
}

export async function triggerVaultSynthesis(): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/memory/synthesis`, { method: 'POST' });
  return res.ok;
}

// ==========================================
// Phase 2: Side Chats (Threads) & Navigation
// ==========================================

export async function listThreads(status?: string): Promise<{ threads: ThreadItem[] }> {
  const url = status ? `${API_BASE}/api/threads?status=${encodeURIComponent(status)}` : `${API_BASE}/api/threads`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to list threads: ${res.status}`);
  return res.json();
}

export async function createThread(params: {
  name: string;
  parent_message_id?: string;
  parent_session_id?: string;
  model?: string;
  initial_summary?: string;
}): Promise<ThreadItem> {
  const res = await fetch(`${API_BASE}/api/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`Failed to create thread: ${res.status}`);
  return res.json();
}

export async function getThread(threadId: string): Promise<ThreadItem> {
  const res = await fetch(`${API_BASE}/api/threads/${threadId}`);
  if (!res.ok) throw new Error(`Failed to get thread ${threadId}: ${res.status}`);
  return res.json();
}

export async function updateThread(
  threadId: string,
  updates: { name?: string; status?: string; rollup_summary?: string }
): Promise<ThreadItem> {
  const res = await fetch(`${API_BASE}/api/threads/${threadId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`Failed to update thread ${threadId}: ${res.status}`);
  return res.json();
}

export async function triggerThreadRollup(threadId: string, conclude: boolean = false): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API_BASE}/api/threads/${threadId}/rollup?conclude=${conclude}`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`Failed to trigger thread rollup: ${res.status}`);
  return res.json();
}

export async function respondToThreadProposal(
  messageId: string,
  action: 'accept' | 'decline'
): Promise<{ status: string; thread?: ThreadItem; proposal: ThreadProposal }> {
  const res = await fetch(`${API_BASE}/api/threads/proposals/${messageId}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) throw new Error(`Failed to respond to proposal: ${res.status}`);
  return res.json();
}

export async function getNavigationLinks(limit: number = 50): Promise<{ links: NavigationLink[] }> {
  const res = await fetch(`${API_BASE}/api/navigation/links?limit=${limit}`);
  if (!res.ok) throw new Error(`Failed to get links: ${res.status}`);
  return res.json();
}

export async function getNavigationChronology(limit: number = 50): Promise<{ events: ChronologyEvent[] }> {
  const res = await fetch(`${API_BASE}/api/navigation/chronology?limit=${limit}`);
  if (!res.ok) throw new Error(`Failed to get chronology: ${res.status}`);
  return res.json();
}


