export type ThinkingEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type RecallBudget = 'low' | 'medium' | 'high';
export type Verbosity = 'low' | 'medium' | 'high';
export type SupportedModel = 'gpt-5.4-mini' | 'gpt-5.4';

export interface Session {
  id: string;
  name: string;
  recall_budget: RecallBudget;
  thinking_effort: ThinkingEffort;
  verbosity: Verbosity;
  model?: SupportedModel;
  created_at: string;
  updated_at: string;
  is_temporary?: boolean;
  is_thread?: number;
  parent_session_id?: string;
  parent_message_id?: string;
  status?: 'active' | 'concluded';
  rollup_summary?: string;
}

export interface ThreadItem {
  id: string;
  name: string;
  is_thread: number;
  parent_session_id?: string;
  parent_message_id?: string;
  status: 'active' | 'concluded';
  rollup_summary?: string;
  model: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
}

export interface ThreadProposal {
  title: string;
  reason: string;
  suggested_first_turn?: string;
  status: 'pending' | 'accepted' | 'declined';
  thread_id?: string;
}

export interface ToolCallState {
  tool: string;
  query?: string;
  result?: string;
  status: 'running' | 'done';
}

export interface AgenticStep {
  step: string;
  message: string;
}

export interface Artifact {
  id: string;
  session_id: string;
  message_id?: string;
  title: string;
  artifact_type: string;
  language?: string;
  content: string;
  summary?: string;
  version: number;
  file_path?: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  memory_status?: string;
  created_at: string;
  // Side chat thread associations
  thread_id?: string;
  thread_proposal?: string | ThreadProposal;
  // Artifact associations
  artifact_id?: string;
  artifact?: Artifact;
  // Staged action for write approval (e.g. gmail_send_email)
  staged_action?: StagedAction;
  // Dynamic streaming & tool state
  reasoning?: string;
  statusText?: string;
  isStreaming?: boolean;
  agenticStep?: AgenticStep;
  toolCalls?: ToolCallState[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface IntegrationServiceStatus {
  calendar: boolean;
  tasks: boolean;
  gmail: boolean;
}

export interface IntegrationStatus {
  google_connected: boolean;
  google_user_email?: string | null;
  services: IntegrationServiceStatus;
  updated_at?: string | null;
}

export interface StagedAction {
  id: string;
  session_id: string;
  message_id?: string | null;
  provider: string;
  action_type: string;
  parameters: {
    to?: string;
    subject?: string;
    body?: string;
    [key: string]: any;
  };
  status: 'pending' | 'executing' | 'executed' | 'declined' | 'failed';
  result?: any;
  created_at: string;
  updated_at: string;
}


export interface NavigationLink {
  url: string;
  title: string;
  message_id: string;
  session_id: string;
  session_name: string;
  is_thread: number;
  created_at: string;
}

export interface ChronologyEvent {
  type: 'thread_event' | 'document_event' | 'link_event' | 'vault_event';
  title: string;
  description: string;
  status?: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

export type ActiveFlyout = 'none' | 'threads' | 'search' | 'documents' | 'links' | 'chronology';

export interface SearchResult {
  id?: string;
  message_id?: string;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
  headline?: string;
  snippet?: string;
  session_name?: string;
}

export interface ScheduledEvent {
  id: string;
  name: string;
  event_type: 'recurring' | 'one_shot';
  cron_expression?: string | null;
  run_at?: string | null;
  timezone: string;
  prompt: string;
  skill_id?: string | null;
  session_id: string;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  last_run_at?: string | null;
  next_run_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  slash_command?: string | null;
  allowed_tools: string[];
  memory_files: string[];
  instructions?: string;
}
