export type ThinkingEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type RecallBudget = 'low' | 'medium' | 'high';
export type Verbosity = 'low' | 'medium' | 'high';

export interface Session {
  id: string;
  name: string;
  recall_budget: RecallBudget;
  thinking_effort: ThinkingEffort;
  verbosity: Verbosity;
  created_at: string;
  updated_at: string;
  is_temporary?: boolean;
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

export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  memory_status?: string;
  created_at: string;
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
