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
  Artifact,
  IntegrationStatus,
  StagedAction,
  ScheduledEvent,
  Skill,
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
  onArtifactCreated?: (artifact: Artifact) => void;
  onActionProposal?: (action: StagedAction) => void;
  onDelta: (text: string) => void;
  onComplete: (data: {
    text: string;
    memory_status: string;
    usage: Record<string, any>;
    user_message_id?: string;
    assistant_message_id?: string;
    thread_proposal?: ThreadProposal;
    artifact?: Artifact;
    artifact_id?: string;
    staged_action?: StagedAction;
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
              } else if (toolName === 'create_artifact') {
                handlers.onStatus?.('Creating artifact');
              } else if (toolName === 'update_artifact') {
                handlers.onStatus?.('Updating artifact');
              } else if (toolName === 'read_mental_model') {
                handlers.onStatus?.('Fetching mental model');
              } else if (toolName === 'propose_side_chat') {
                handlers.onStatus?.('Proposing side chat');
              } else if (toolName === 'gcal_list_events') {
                handlers.onStatus?.('Checking calendar');
              } else if (toolName === 'gcal_create_event') {
                handlers.onStatus?.('Scheduling event');
              } else if (toolName === 'gcal_delete_event') {
                handlers.onStatus?.('Deleting event');
              } else if (toolName === 'gtasks_list_tasks') {
                handlers.onStatus?.('Checking tasks');
              } else if (toolName === 'gtasks_create_task') {
                handlers.onStatus?.('Creating task');
              } else if (toolName === 'gtasks_complete_task') {
                handlers.onStatus?.('Completing task');
              } else if (toolName === 'gmail_list_unread') {
                handlers.onStatus?.('Checking emails');
              } else if (toolName === 'gmail_create_draft') {
                handlers.onStatus?.('Drafting email');
              } else if (toolName === 'gmail_send_email') {
                handlers.onStatus?.('Staging email for confirmation');
              }
              handlers.onToolStart?.(toolName, data.query || '');
            } else if (currentEvent === 'artifact_created') {
              handlers.onArtifactCreated?.(data);
            } else if (currentEvent === 'action_proposal') {
              handlers.onActionProposal?.(data);
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
                artifact: data.artifact,
                artifact_id: data.artifact_id,
                staged_action: data.staged_action,
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

// ==========================================
// Phase 3: Artifact Canvas & PDF Export
// ==========================================

export async function listArtifacts(sessionId?: string): Promise<{ artifacts: Artifact[] }> {
  const url = sessionId ? `${API_BASE}/api/artifacts?session_id=${encodeURIComponent(sessionId)}` : `${API_BASE}/api/artifacts`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to list artifacts: ${res.status}`);
  return res.json();
}

export async function getArtifact(artifactId: string): Promise<Artifact> {
  const res = await fetch(`${API_BASE}/api/artifacts/${artifactId}`);
  if (!res.ok) throw new Error(`Failed to get artifact ${artifactId}: ${res.status}`);
  return res.json();
}

export function getArtifactPdfUrl(artifactId: string): string {
  return `${API_BASE}/api/artifacts/${artifactId}/export/pdf`;
}

// ==========================================
// Phase 4: Integrations & Staged Actions
// ==========================================

export async function getIntegrationStatus(): Promise<IntegrationStatus> {
  const res = await fetch(`${API_BASE}/api/integrations/status`);
  if (!res.ok) throw new Error(`Failed to get integration status: ${res.status}`);
  return res.json();
}

export async function disconnectGoogle(): Promise<{ status: string; provider: string }> {
  const res = await fetch(`${API_BASE}/api/integrations/google`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to disconnect Google: ${res.status}`);
  return res.json();
}

export async function getGoogleAuthUrl(): Promise<{ url: string }> {
  const res = await fetch(`${API_BASE}/api/auth/google/login`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    throw new Error(err.detail || 'Failed to get Google OAuth URL');
  }
  return res.json();
}

export async function listStagedActions(sessionId?: string, status?: string): Promise<StagedAction[]> {
  const params = new URLSearchParams();
  if (sessionId) params.append('session_id', sessionId);
  if (status) params.append('status', status);
  const res = await fetch(`${API_BASE}/api/actions?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed to list actions: ${res.status}`);
  return res.json();
}

export async function respondToStagedAction(actionId: string, action: 'confirm' | 'decline'): Promise<StagedAction> {
  const res = await fetch(`${API_BASE}/api/actions/${actionId}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    throw new Error(err.detail || `Failed to respond to action: ${res.status}`);
  }
  return res.json();
}


// ==========================================
// Phase 5: Scheduled Events & Skills
// ==========================================

export async function listSchedules(status?: string, eventType?: string): Promise<ScheduledEvent[]> {
  const params = new URLSearchParams();
  if (status) params.append('status', status);
  if (eventType) params.append('event_type', eventType);
  const res = await fetch(`${API_BASE}/api/schedules?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed to list schedules: ${res.status}`);
  return res.json();
}

export async function createSchedule(data: {
  name: string;
  event_type: 'recurring' | 'one_shot';
  prompt: string;
  cron_expression?: string;
  run_at?: string;
  timezone?: string;
  skill_id?: string;
  session_id?: string;
}): Promise<ScheduledEvent> {
  const res = await fetch(`${API_BASE}/api/schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    throw new Error(err.detail || 'Failed to create schedule');
  }
  return res.json();
}

export async function updateSchedule(
  eventId: string,
  data: Partial<{
    name: string;
    event_type: 'recurring' | 'one_shot';
    prompt: string;
    cron_expression: string;
    run_at: string;
    timezone: string;
    skill_id: string;
    status: 'active' | 'paused' | 'completed' | 'cancelled';
  }>
): Promise<ScheduledEvent> {
  const res = await fetch(`${API_BASE}/api/schedules/${eventId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    throw new Error(err.detail || 'Failed to update schedule');
  }
  return res.json();
}

export async function deleteSchedule(eventId: string): Promise<{ status: string; id: string }> {
  const res = await fetch(`${API_BASE}/api/schedules/${eventId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete schedule: ${res.status}`);
  return res.json();
}

export async function listSkills(): Promise<Skill[]> {
  const res = await fetch(`${API_BASE}/api/skills`);
  if (!res.ok) throw new Error(`Failed to list skills: ${res.status}`);
  return res.json();
}

export async function getSkill(skillId: string): Promise<Skill> {
  const res = await fetch(`${API_BASE}/api/skills/${skillId}`);
  if (!res.ok) throw new Error(`Failed to get skill: ${res.status}`);
  return res.json();
}

export async function createSkill(data: {
  id: string;
  name: string;
  description: string;
  instructions: string;
  enabled?: boolean;
  slash_command?: string;
  allowed_tools?: string[];
  memory_files?: string[];
}): Promise<Skill> {
  const res = await fetch(`${API_BASE}/api/skills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    throw new Error(err.detail || 'Failed to create skill');
  }
  return res.json();
}

export async function updateSkill(
  skillId: string,
  data: Partial<{
    name: string;
    description: string;
    instructions: string;
    enabled: boolean;
    slash_command: string;
    allowed_tools: string[];
    memory_files: string[];
  }>
): Promise<Skill> {
  const res = await fetch(`${API_BASE}/api/skills/${skillId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    throw new Error(err.detail || 'Failed to update skill');
  }
  return res.json();
}

export async function deleteSkill(skillId: string): Promise<{ status: string; id: string }> {
  const res = await fetch(`${API_BASE}/api/skills/${skillId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete skill: ${res.status}`);
  return res.json();
}




