import { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, ArrowUp, Square, PanelLeft, Ghost } from 'lucide-react';
import type { Session, ChatMessage, ThinkingEffort, RecallBudget, Verbosity } from './types';
import * as api from './api';
import { Sidebar } from './components/Sidebar';
import { OptionsMenu } from './components/OptionsMenu';
import { ChatMessageView } from './components/ChatMessageView';

export function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isBackendOnline, setIsBackendOnline] = useState(true);
  const [isTemporary, setIsTemporary] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Dark/Light Theme state
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('velocity-theme') as 'dark' | 'light') || 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
    }
    localStorage.setItem('velocity-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Options Popover & Toggles
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [thinkingEffort, setThinkingEffort] = useState<ThinkingEffort>('medium');
  const [recallBudget, setRecallBudget] = useState<RecallBudget>('medium');
  const [verbosity, setVerbosity] = useState<Verbosity>('low');

  // Input state
  const [inputValue, setInputValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // 1. Initial Load & Health Polling
  useEffect(() => {
    let mounted = true;

    async function init() {
      const online = await api.checkHealth();
      if (!mounted) return;
      setIsBackendOnline(online);

      try {
        const loadedSessions = await api.listSessions();
        if (!mounted) return;
        setSessions(loadedSessions);

        if (loadedSessions.length > 0) {
          const first = loadedSessions[0];
          setCurrentSessionId(first.id);
          setThinkingEffort(first.thinking_effort || 'medium');
          setRecallBudget(first.recall_budget || 'medium');
          setVerbosity(first.verbosity || 'low');

          const { messages: history } = await api.getSessionMessages(first.id);
          if (mounted) setMessages(history);
        } else {
          // If no sessions exist, start in compose mode without saving empty session
          setCurrentSessionId(null);
          setMessages([]);
        }
      } catch (e) {
        console.error('Initialization error:', e);
      }
    }

    init();

    // Check health periodically
    const interval = setInterval(async () => {
      const online = await api.checkHealth();
      if (mounted) setIsBackendOnline(online);
    }, 8000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Prepare blank new chat without saving to SQLite until user sends prompt
  const handleNewChat = useCallback(() => {
    if (isStreaming) return;
    setCurrentSessionId(null);
    setMessages([]);
    setIsTemporary(false);
    textareaRef.current?.focus();
  }, [isStreaming]);

  // Keyboard shortcut: Cmd+Shift+O for New Chat
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        handleNewChat();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNewChat]);

  // Scroll to bottom helper
  const scrollToBottom = useCallback(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTo({
        top: chatScrollRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Switch session
  const handleSelectSession = async (sessionId: string) => {
    if (isStreaming) return;
    setCurrentSessionId(sessionId);
    setIsTemporary(false);
    const session = sessions.find((s) => s.id === sessionId);
    if (session) {
      setThinkingEffort(session.thinking_effort || 'medium');
      setRecallBudget(session.recall_budget || 'medium');
      setVerbosity(session.verbosity || 'low');
    }

    try {
      const { messages: history } = await api.getSessionMessages(sessionId);
      setMessages(history);
    } catch (err) {
      console.error('Failed to load session messages:', err);
    }
  };

  // Delete session
  const handleDeleteSession = async (sessionId: string) => {
    try {
      await api.deleteSession(sessionId);
      const remaining = sessions.filter((s) => s.id !== sessionId);
      setSessions(remaining);

      if (currentSessionId === sessionId) {
        if (remaining.length > 0) {
          handleSelectSession(remaining[0].id);
        } else {
          handleNewChat();
        }
      }
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  };

  // Rename session
  const handleRenameSession = async (sessionId: string, newName: string) => {
    try {
      const updated = await api.updateSession(sessionId, { name: newName });
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? updated : s)));
    } catch (err) {
      console.error('Failed to rename session:', err);
    }
  };

  // Options Handlers (Sticky)
  const handleUpdateEffort = async (newEffort: ThinkingEffort) => {
    setThinkingEffort(newEffort);
    if (currentSessionId && !isTemporary) {
      try {
        const updated = await api.updateSession(currentSessionId, { thinking_effort: newEffort });
        setSessions((prev) => prev.map((s) => (s.id === currentSessionId ? updated : s)));
      } catch (err) {
        console.error('Failed to update effort:', err);
      }
    }
  };

  const handleUpdateRecall = async (newRecall: RecallBudget) => {
    setRecallBudget(newRecall);
    if (currentSessionId && !isTemporary) {
      try {
        const updated = await api.updateSession(currentSessionId, { recall_budget: newRecall });
        setSessions((prev) => prev.map((s) => (s.id === currentSessionId ? updated : s)));
      } catch (err) {
        console.error('Failed to update recall:', err);
      }
    }
  };

  const handleUpdateVerbosity = async (newVerbosity: Verbosity) => {
    setVerbosity(newVerbosity);
    if (currentSessionId && !isTemporary) {
      try {
        const updated = await api.updateSession(currentSessionId, { verbosity: newVerbosity });
        setSessions((prev) => prev.map((s) => (s.id === currentSessionId ? updated : s)));
      } catch (err) {
        console.error('Failed to update verbosity:', err);
      }
    }
  };

  // Send message turn
  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputValue).trim();
    if (!text || isStreaming) return;

    let targetSessionId = currentSessionId;
    // Only create session in backend if this is a new chat
    if (!targetSessionId) {
      if (!isTemporary) {
        try {
          const newSess = await api.createSession({
            recall_budget: recallBudget,
            thinking_effort: thinkingEffort,
            verbosity: verbosity,
          });
          setSessions((prev) => [newSess, ...prev]);
          setCurrentSessionId(newSess.id);
          targetSessionId = newSess.id;
        } catch (e) {
          console.error('Failed to create session on message send:', e);
          return;
        }
      } else {
        targetSessionId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `temp-${Date.now()}`;
        setCurrentSessionId(targetSessionId);
      }
    }

    setInputValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    setIsOptionsOpen(false);

    // 1. Generate stable IDs matching backend
    const userMsgId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `user-${Date.now()}`;
    const asstMsgId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `asst-${Date.now()}`;

    const userMsg: ChatMessage = {
      id: userMsgId,
      session_id: targetSessionId,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    };

    const asstMsg: ChatMessage = {
      id: asstMsgId,
      session_id: targetSessionId,
      role: 'assistant',
      content: '',
      isStreaming: true,
      reasoning: '',
      toolCalls: [],
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg, asstMsg]);
    setIsStreaming(true);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      await api.streamChatTurn(
        {
          sessionId: targetSessionId,
          message: text,
          messageId: userMsgId,
          recallBudget,
          thinkingEffort,
          verbosity,
          isTemporary,
        },
        {
          onSessionRenamed: (name) => {
            setSessions((prev) =>
              prev.map((s) => (s.id === targetSessionId ? { ...s, name } : s))
            );
          },
          onAgenticStep: (step) => {
            setMessages((prev) =>
              prev.map((m) => (m.id === asstMsgId ? { ...m, agenticStep: step } : m))
            );
          },
          onReasoningDelta: (deltaText) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === asstMsgId
                  ? { ...m, reasoning: (m.reasoning || '') + deltaText }
                  : m
              )
            );
          },
          onToolStart: (tool, query) => {
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== asstMsgId) return m;
                const existing = m.toolCalls || [];
                return {
                  ...m,
                  toolCalls: [...existing, { tool, query, status: 'running' }],
                };
              })
            );
          },
          onToolDone: (tool, result) => {
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== asstMsgId) return m;
                const existing = m.toolCalls || [];
                const updated = existing.map((tc) =>
                  tc.tool === tool && tc.status === 'running'
                    ? { ...tc, result, status: 'done' as const }
                    : tc
                );
                return { ...m, toolCalls: updated };
              })
            );
          },
          onDelta: (deltaText) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === asstMsgId
                  ? { ...m, content: m.content + deltaText }
                  : m
              )
            );
          },
          onComplete: (data) => {
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id === asstMsgId) {
                  return {
                    ...m,
                    id: data.assistant_message_id || m.id,
                    content: data.text || m.content,
                    usage: data.usage,
                    isStreaming: false,
                  };
                }
                if (m.id === userMsgId && data.user_message_id) {
                  return {
                    ...m,
                    id: data.user_message_id,
                  };
                }
                return m;
              })
            );
            setIsStreaming(false);
          },
          onError: (err) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === asstMsgId
                  ? {
                      ...m,
                      content: m.content || `⚠️ Error: ${err}`,
                      isStreaming: false,
                    }
                  : m
              )
            );
            setIsStreaming(false);
          },
        },
        abortController.signal
      );
    } catch (err: any) {
      if (!abortController.signal.aborted) {
        console.error('Chat turn error:', err);
      }
      setIsStreaming(false);
    }
  };

  // Stop streaming
  const handleStopStreaming = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
    setMessages((prev) =>
      prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m))
    );
  };

  // Edit user prompt & resend: truncates subsequent SQLite messages from that prompt onward
  const handleEditAndResend = async (messageId: string, newContent: string) => {
    if (!currentSessionId || isStreaming) return;

    const targetIdx = messages.findIndex((m) => m.id === messageId);
    if (targetIdx === -1) return;

    // 1. Truncate backend messages from target message onward
    await api.truncateMessagesFrom(currentSessionId, messageId);

    // 2. Slice local messages state
    const trimmed = messages.slice(0, targetIdx);
    setMessages(trimmed);

    // 3. Send new message turn
    handleSendMessage(newContent);
  };

  // Regenerate assistant response (works on ANY assistant response in the conversation)
  const handleRegenerate = async (asstMessageId: string) => {
    if (!currentSessionId || isStreaming || messages.length === 0) return;

    const asstIdx = messages.findIndex((m) => m.id === asstMessageId);
    if (asstIdx === -1) return;

    // Find the user message directly preceding this assistant response
    let userIdx = -1;
    for (let i = asstIdx - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        userIdx = i;
        break;
      }
    }
    if (userIdx === -1) return;

    const userMsg = messages[userIdx];

    // 1. Truncate in SQLite from this assistant message onward
    await api.truncateMessagesFrom(currentSessionId, asstMessageId);

    // 2. Slice local messages state up to user message
    const trimmed = messages.slice(0, asstIdx);
    setMessages(trimmed);

    // 3. Re-trigger stream with the user prompt
    handleSendMessage(userMsg.content);
  };

  // Is options button highlighted (any non-default values)?
  const isOptionsHighlighted =
    isOptionsOpen ||
    thinkingEffort !== 'medium' ||
    recallBudget !== 'medium' ||
    verbosity !== 'low';

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-black text-white font-sans">
      {/* 1. Collapsible Sidebar (Flat, no borders) */}
      {sidebarOpen && (
        <Sidebar
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSelectSession={handleSelectSession}
          onNewChat={handleNewChat}
          onDeleteSession={handleDeleteSession}
          onRenameSession={handleRenameSession}
          isBackendOnline={isBackendOnline}
          onSearch={api.searchMessages}
          onCloseSidebar={() => setSidebarOpen(false)}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      )}

      {/* 2. Main Chat Area */}
      <main className="flex-1 flex flex-col h-full min-w-0 relative bg-black">
        {/* Top Minimal Header: Pure clean canvas, NO borders, NO orange dot */}
        <header className="h-12 flex items-center justify-between px-6 flex-shrink-0 select-none">
          <div className="flex items-center gap-3">
            {!sidebarOpen && (
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-[#141414] transition-colors"
                title="Open sidebar"
              >
                <PanelLeft className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Temp chat button: only visible on new chat (no current messages) */}
            {(!currentSessionId || messages.length === 0) && (
              <button
                type="button"
                onClick={() => setIsTemporary(!isTemporary)}
                title={isTemporary ? 'Temporary Chat Active (Click to disable)' : 'Enable Temporary Chat (Ephemeral)'}
                className={`p-2 rounded-xl transition-all ${
                  isTemporary
                    ? 'bg-[#27272A] text-white shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-[#141414]'
                }`}
              >
                <Ghost className="w-4 h-4" />
              </button>
            )}
          </div>
        </header>

        {/* Chat Scroll Window */}
        <div
          ref={chatScrollRef}
          className="flex-1 overflow-y-auto px-4 sm:px-8 py-6 flex flex-col justify-start"
        >
          <div className="w-full max-w-3xl mx-auto flex flex-col flex-1">
            {messages.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center select-none py-20">
                <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white mb-2">
                  Velocity
                </h1>
                <p className="text-sm text-zinc-400 max-w-md">
                  Your personal engineering co-pilot and cognitive second brain. How can I help you think, build, or decide today?
                </p>
              </div>
            ) : (
              messages.map((msg) => (
                <ChatMessageView
                  key={msg.id}
                  message={msg}
                  onEditAndResend={handleEditAndResend}
                  onRegenerate={handleRegenerate}
                />
              ))
            )}
          </div>
        </div>

        {/* Bottom Floating Input Capsule & Popover */}
        <div className="p-4 sm:pb-6 sm:px-8 flex-shrink-0 flex justify-center w-full">
          <div className="relative w-full max-w-3xl">
            {/* Options Menu Popover directly anchored above the '+' button */}
            <OptionsMenu
              isOpen={isOptionsOpen}
              onClose={() => setIsOptionsOpen(false)}
              thinkingEffort={thinkingEffort}
              recallBudget={recallBudget}
              verbosity={verbosity}
              onUpdateEffort={handleUpdateEffort}
              onUpdateRecall={handleUpdateRecall}
              onUpdateVerbosity={handleUpdateVerbosity}
            />

            {/* Input Capsule (Flat, NO borders) */}
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-full bg-[#141414] shadow-2xl transition-all">
              {/* '+' Options Button */}
              <button
                id="options-toggle-btn"
                type="button"
                onClick={() => setIsOptionsOpen(!isOptionsOpen)}
                title="Configure Effort, Recall & Verbosity"
                className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
                  isOptionsHighlighted
                    ? 'bg-[#27272A] text-white'
                    : 'bg-[#27272A] text-zinc-300 hover:text-white hover:bg-[#343438]'
                }`}
              >
                <Plus
                  className={`w-4 h-4 transition-transform duration-150 ${
                    isOptionsOpen ? 'rotate-45' : 'rotate-0'
                  }`}
                />
              </button>

              {/* Auto-expanding Input Field */}
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${Math.min(160, Math.max(24, e.target.scrollHeight))}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder="Message Velocity..."
                rows={1}
                className="flex-1 bg-transparent text-[15px] font-medium text-white placeholder-zinc-500 outline-none resize-none py-1 px-1 leading-snug max-h-40"
              />

              {/* Send or Stop Generation Button */}
              {isStreaming ? (
                <button
                  type="button"
                  onClick={handleStopStreaming}
                  title="Stop generating"
                  className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-white hover:bg-zinc-200 text-black transition-colors"
                >
                  <Square className="w-3.5 h-3.5 fill-black" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleSendMessage()}
                  disabled={!inputValue.trim()}
                  title="Send message"
                  className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
                    inputValue.trim()
                      ? 'bg-white text-black hover:bg-zinc-200'
                      : 'bg-[#27272A] text-zinc-500 cursor-not-allowed'
                  }`}
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
