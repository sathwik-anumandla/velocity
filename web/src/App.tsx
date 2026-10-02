import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ArrowUp,
  Square,
  Ghost,
  ArrowDown,
  ArrowLeft,
  GitBranch,
  CheckCircle2,
  RotateCcw,
  Sparkles,
  Plus,
} from 'lucide-react';
import type {
  ChatMessage,
  ThinkingEffort,
  RecallBudget,
  Verbosity,
  SupportedModel,
  ActiveFlyout,
  ThreadItem,
} from './types';
import * as api from './api';
import { NavigationRail } from './components/NavigationRail';
import { OptionsMenu } from './components/OptionsMenu';
import { ChatMessageView } from './components/ChatMessageView';
import { SearchModal } from './components/SearchModal';
import { MemoryInspectorModal } from './components/MemoryInspectorModal';
import { getGreetingForCurrentTime } from './utils/greetings';

export function App() {
  // Session & Thread state: default to 'main' lifelong continuous timeline
  const [currentSessionId, setCurrentSessionId] = useState<string>('main');
  const [activeThread, setActiveThread] = useState<ThreadItem | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isBackendOnline, setIsBackendOnline] = useState(true);
  const [healthDetails, setHealthDetails] = useState<api.HealthDetails | null>(null);
  const [isTemporary, setIsTemporary] = useState(false);

  // Navigation Rail & Flyouts
  const [activeFlyout, setActiveFlyout] = useState<ActiveFlyout>('none');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMemoryInspectorOpen, setIsMemoryInspectorOpen] = useState(false);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);

  // Dynamic Greeting state (contextual by time of day)
  const [greeting, setGreeting] = useState<string>(() => getGreetingForCurrentTime());

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
  const [selectedModel, setSelectedModel] = useState<SupportedModel>(() => {
    return (localStorage.getItem('velocity-preferred-model') as SupportedModel) || 'gpt-5.4-mini';
  });
  const [thinkingEffort, setThinkingEffort] = useState<ThinkingEffort>('medium');
  const [recallBudget, setRecallBudget] = useState<RecallBudget>('medium');
  const [verbosity, setVerbosity] = useState<Verbosity>('low');

  // Input state
  const [inputValue, setInputValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Scroll handler to track when user deliberately scrolls up away from bottom
  const handleScroll = useCallback(() => {
    if (!chatScrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = chatScrollRef.current;
    const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
    setIsUserScrolledUp(distanceFromBottom > 120);
  }, []);

  // Scroll to bottom helper
  const scrollToBottom = useCallback((force: boolean = false) => {
    if (chatScrollRef.current) {
      if (!force && isUserScrolledUp) return;
      chatScrollRef.current.scrollTo({
        top: chatScrollRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [isUserScrolledUp]);

  useEffect(() => {
    if (!isUserScrolledUp) {
      scrollToBottom();
    }
  }, [messages, isUserScrolledUp, scrollToBottom]);

  // Switch session: loads history for 'main' timeline or specific thread
  const handleSelectSession = useCallback(async (sessionId: string) => {
    if (isStreaming) return;
    const target = sessionId || 'main';
    localStorage.setItem('velocity-active-session', target);
    setCurrentSessionId(target);
    setIsTemporary(false);
    setIsUserScrolledUp(false);

    if (target !== 'main') {
      try {
        const thread = await api.getThread(target);
        setActiveThread(thread);
      } catch {
        setActiveThread(null);
      }
    } else {
      setActiveThread(null);
    }

    try {
      const { session, messages: history } = await api.getSessionMessages(target);
      if (session) {
        setSelectedModel(session.model || 'gpt-5.4-mini');
        setThinkingEffort(session.thinking_effort || 'medium');
        setRecallBudget(session.recall_budget || 'medium');
        setVerbosity(session.verbosity || 'low');
      }
      setMessages(history);
      setTimeout(() => scrollToBottom(true), 50);
    } catch (err) {
      console.error('Failed to load session messages:', err);
      setMessages([]);
    }
  }, [isStreaming, scrollToBottom]);

  // 1. Initial Load & Health Polling
  useEffect(() => {
    let mounted = true;

    async function init() {
      const health = await api.getHealthDetails();
      if (!mounted) return;
      setIsBackendOnline(health.status === 'ok');
      setHealthDetails(health);

      const savedActive = localStorage.getItem('velocity-active-session') || 'main';
      handleSelectSession(savedActive);
    }

    init();

    const interval = setInterval(async () => {
      const health = await api.getHealthDetails();
      if (mounted) {
        setIsBackendOnline(health.status === 'ok');
        setHealthDetails(health);
      }
    }, 8000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [handleSelectSession]);

  // Handle user responding to a side chat proposal card
  const handleRespondProposal = useCallback(async (messageId: string, action: 'accept' | 'decline') => {
    try {
      const res = await api.respondToThreadProposal(messageId, action);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, thread_proposal: res.proposal } : m
        )
      );
      if (action === 'accept' && res.thread) {
        handleSelectSession(res.thread.id);
      }
    } catch (err) {
      console.error('Failed to respond to proposal:', err);
    }
  }, [handleSelectSession]);

  // Conclude active side chat
  const handleConcludeActiveThread = useCallback(async () => {
    if (!activeThread) return;
    try {
      await api.triggerThreadRollup(activeThread.id, true);
      setActiveThread((prev) => (prev ? { ...prev, status: 'concluded' } : null));
    } catch (err) {
      console.error('Failed to conclude side chat:', err);
    }
  }, [activeThread]);

  // Reopen active side chat
  const handleReopenActiveThread = useCallback(async () => {
    if (!activeThread) return;
    try {
      await api.updateThread(activeThread.id, { status: 'active' });
      setActiveThread((prev) => (prev ? { ...prev, status: 'active' } : null));
    } catch (err) {
      console.error('Failed to reopen side chat:', err);
    }
  }, [activeThread]);

  // Trigger rollup synthesis manually
  const handleRollupActiveThread = useCallback(async () => {
    if (!activeThread) return;
    try {
      await api.triggerThreadRollup(activeThread.id, false);
    } catch (err) {
      console.error('Failed to trigger rollup:', err);
    }
  }, [activeThread]);

  // Toggle temporary scratch turn
  const handleToggleTempChat = useCallback(() => {
    if (isStreaming) return;
    setIsTemporary((prev) => !prev);
  }, [isStreaming]);

  // Global keyboard shortcuts: ⌘K (Search), ⌘M (Memory Inspector), Esc (Dismiss)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;

      if (isMeta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
        return;
      }

      if (isMeta && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        setIsMemoryInspectorOpen((prev) => !prev);
        return;
      }

      if (e.key === 'Escape') {
        setIsSearchOpen(false);
        setIsOptionsOpen(false);
        setIsMemoryInspectorOpen(false);
        setActiveFlyout('none');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Options Handlers (Sticky)
  const handleUpdateModel = async (newModel: SupportedModel) => {
    setSelectedModel(newModel);
    localStorage.setItem('velocity-preferred-model', newModel);
    if (currentSessionId && !isTemporary) {
      try {
        await api.updateSession(currentSessionId, { model: newModel });
      } catch (err) {
        console.error('Failed to update model:', err);
      }
    }
  };

  const handleUpdateEffort = async (newEffort: ThinkingEffort) => {
    setThinkingEffort(newEffort);
    if (currentSessionId && !isTemporary) {
      try {
        await api.updateSession(currentSessionId, { thinking_effort: newEffort });
      } catch (err) {
        console.error('Failed to update effort:', err);
      }
    }
  };

  const handleUpdateRecall = async (newRecall: RecallBudget) => {
    setRecallBudget(newRecall);
    if (currentSessionId && !isTemporary) {
      try {
        await api.updateSession(currentSessionId, { recall_budget: newRecall });
      } catch (err) {
        console.error('Failed to update recall:', err);
      }
    }
  };

  const handleUpdateVerbosity = async (newVerbosity: Verbosity) => {
    setVerbosity(newVerbosity);
    if (currentSessionId && !isTemporary) {
      try {
        await api.updateSession(currentSessionId, { verbosity: newVerbosity });
      } catch (err) {
        console.error('Failed to update verbosity:', err);
      }
    }
  };

  // Send message turn
  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputValue).trim();
    if (!text || isStreaming) return;

    const targetSessionId = currentSessionId || 'main';

    setInputValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    setIsOptionsOpen(false);

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
      statusText: 'Thinking',
      reasoning: '',
      toolCalls: [],
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg, asstMsg]);
    setIsStreaming(true);
    setIsUserScrolledUp(false);
    setTimeout(() => scrollToBottom(true), 20);

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
          model: selectedModel,
          isTemporary,
        },
        {
          onStatus: (statusText) => {
            setMessages((prev) =>
              prev.map((m) => (m.id === asstMsgId ? { ...m, statusText } : m))
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
          onThreadProposal: (proposal) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === asstMsgId ? { ...m, thread_proposal: proposal } : m
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
                    statusText: undefined,
                    thread_proposal: data.thread_proposal || m.thread_proposal,
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
                      content: m.content || `[Error]: ${err}`,
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

  // Edit user prompt & resend
  const handleEditAndResend = async (messageId: string, newContent: string) => {
    if (!currentSessionId || isStreaming) return;

    const targetIdx = messages.findIndex((m) => m.id === messageId);
    if (targetIdx === -1) return;

    await api.truncateMessagesFrom(currentSessionId, messageId);
    const trimmed = messages.slice(0, targetIdx);
    setMessages(trimmed);

    setIsUserScrolledUp(false);
    handleSendMessage(newContent);
  };

  // Regenerate assistant response
  const handleRegenerate = async (asstMessageId: string) => {
    if (!currentSessionId || isStreaming || messages.length === 0) return;

    const asstIdx = messages.findIndex((m) => m.id === asstMessageId);
    if (asstIdx === -1) return;

    let userIdx = -1;
    for (let i = asstIdx - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        userIdx = i;
        break;
      }
    }
    if (userIdx === -1) return;

    const userMsg = messages[userIdx];
    await api.truncateMessagesFrom(currentSessionId, asstMessageId);
    const trimmed = messages.slice(0, asstIdx);
    setMessages(trimmed);

    setIsUserScrolledUp(false);
    handleSendMessage(userMsg.content);
  };

  const isOptionsHighlighted =
    selectedModel !== 'gpt-5.4-mini' ||
    thinkingEffort !== 'medium' ||
    recallBudget !== 'medium' ||
    verbosity !== 'low';

  // Render input capsule
  const renderInputCapsule = (isCentered: boolean = false) => (
    <div
      className={`relative w-full ${
        isCentered ? 'max-w-2xl sm:max-w-3xl' : 'max-w-3xl'
      } flex flex-col items-center select-none`}
    >
      <OptionsMenu
        isOpen={isOptionsOpen}
        onClose={() => setIsOptionsOpen(false)}
        selectedModel={selectedModel}
        thinkingEffort={thinkingEffort}
        recallBudget={recallBudget}
        verbosity={verbosity}
        onUpdateModel={handleUpdateModel}
        onUpdateEffort={handleUpdateEffort}
        onUpdateRecall={handleUpdateRecall}
        onUpdateVerbosity={handleUpdateVerbosity}
      />

      {/* Input Capsule */}
      <div className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-[26px] bg-[var(--bg-input)] shadow-2xl transition-all border border-zinc-800/60 focus-within:border-zinc-700">
        <button
          id="options-toggle-btn"
          type="button"
          onClick={() => setIsOptionsOpen(!isOptionsOpen)}
          title="Configure Effort, Recall & Verbosity"
          className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
            isOptionsHighlighted
              ? 'bg-[var(--bg-pill-hover)] text-[var(--text-primary)]'
              : 'bg-[var(--bg-pill)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-pill-hover)]'
          }`}
        >
          <Plus
            className={`w-4 h-4 transition-transform duration-150 ${
              isOptionsOpen ? 'rotate-45' : 'rotate-0'
            }`}
          />
        </button>

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
          placeholder={
            activeThread
              ? `Focus on ${activeThread.name}...`
              : isTemporary
              ? 'Message in Temporary Scratch turn...'
              : 'Message Velocity...'
          }
          rows={1}
          className="flex-1 bg-transparent text-[16px] sm:text-[16.5px] font-medium text-[var(--text-primary)] placeholder-[var(--text-dim)] outline-none resize-none py-1.5 px-1 leading-snug max-h-40"
        />

        {isStreaming ? (
          <button
            type="button"
            onClick={handleStopStreaming}
            title="Stop generating"
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-[var(--text-primary)] text-[var(--bg-primary)] hover:opacity-90 transition-opacity"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => handleSendMessage()}
            disabled={!inputValue.trim()}
            title="Send message"
            className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
              inputValue.trim()
                ? 'bg-[var(--text-primary)] text-[var(--bg-primary)] hover:opacity-90'
                : 'bg-[var(--bg-pill)] text-[var(--text-dim)] cursor-not-allowed'
            }`}
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)] font-sans">
      {/* 1. WhatsApp-Style Navigation Rail with Sliding Flyouts */}
      <NavigationRail
        currentSessionId={currentSessionId}
        activeFlyout={activeFlyout}
        onSelectFlyout={setActiveFlyout}
        onSelectSession={handleSelectSession}
        onOpenMemoryInspector={() => setIsMemoryInspectorOpen(true)}
        theme={theme}
        onToggleTheme={toggleTheme}
        isBackendOnline={isBackendOnline}
        healthDetails={healthDetails}
      />

      {/* 2. Main Work Area (Lifelong Timeline or Full-screen Side Chat) */}
      <main className="flex-1 flex flex-col h-full min-w-0 relative bg-[var(--bg-primary)]">
        {/* Top Header */}
        <header className="relative z-20 h-13 border-b border-zinc-800/80 bg-[#000000]/80 backdrop-blur-md flex items-center justify-between px-6 flex-shrink-0 select-none">
          {activeThread ? (
            /* Side Chat (Thread) Dedicated Full-Screen Top Bar */
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleSelectSession('main')}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Main Timeline</span>
                </button>
                <div className="w-[1px] h-4 bg-zinc-800" />
                <div className="flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-sky-400" />
                  <h2 className="text-sm font-semibold text-zinc-100 truncate max-w-[280px] sm:max-w-md">
                    {activeThread.name}
                  </h2>
                  <span
                    className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full border ${
                      activeThread.status === 'active'
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                    }`}
                  >
                    {activeThread.status}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRollupActiveThread}
                  title="Synthesize updated rollup summary"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 text-xs font-medium transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Rollup</span>
                </button>

                {activeThread.status === 'active' ? (
                  <button
                    type="button"
                    onClick={handleConcludeActiveThread}
                    title="Conclude side chat and generate rollup summary"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs font-medium transition-colors"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Conclude</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleReopenActiveThread}
                    title="Reopen side chat"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs font-medium transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-sky-400" />
                    <span>Reopen</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            /* Main Continuous Timeline Top Bar */
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2.5">
                <span className="text-sm font-bold tracking-tight text-zinc-100">Velocity</span>
                <span className="text-[11px] font-medium text-zinc-500 hidden sm:inline">
                  Direct, sharp engineering peer
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleToggleTempChat}
                  title={
                    isTemporary
                      ? 'Temporary Scratch Turn Active (Click to disable)'
                      : 'Enable Temporary Scratch Turn'
                  }
                  className={`p-2 rounded-xl transition-all ${
                    isTemporary
                      ? 'bg-[var(--bg-pill)] text-[var(--text-primary)] shadow-sm'
                      : 'text-[var(--text-dim)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
                  }`}
                >
                  <Ghost className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </header>

        {/* 3. Centered Empty State vs. Continuous Conversation View */}
        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-8 select-none">
            <div className="w-full max-w-2xl sm:max-w-3xl flex flex-col items-center -translate-y-8">
              <h1
                onClick={() => setGreeting((prev) => getGreetingForCurrentTime(prev))}
                title="Click to shuffle greeting"
                className="text-3xl sm:text-4xl font-bold tracking-tight text-[var(--text-primary)] mb-8 text-center font-sans cursor-pointer hover:opacity-80 active:scale-[0.99] transition-all"
              >
                {activeThread ? activeThread.name : greeting}
              </h1>
              {renderInputCapsule(true)}
            </div>
          </div>
        ) : (
          <div className="relative flex-1 flex flex-col min-h-0">
            <div
              ref={chatScrollRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto px-4 sm:px-8 py-6 flex flex-col justify-start"
            >
              <div className="w-full max-w-3xl mx-auto flex flex-col flex-1">
                {messages.map((msg) => (
                  <ChatMessageView
                    key={msg.id}
                    message={msg}
                    onEditAndResend={handleEditAndResend}
                    onRegenerate={handleRegenerate}
                    onOpenThread={(threadId) => handleSelectSession(threadId)}
                    onRespondProposal={handleRespondProposal}
                  />
                ))}
              </div>
            </div>

            {/* Scroll to Bottom Button */}
            {isUserScrolledUp && (
              <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-30 animate-fade-in pointer-events-auto">
                <button
                  type="button"
                  onClick={() => {
                    setIsUserScrolledUp(false);
                    scrollToBottom(true);
                  }}
                  title="Scroll to bottom"
                  className="w-9 h-9 rounded-full flex items-center justify-center bg-[var(--bg-pill)] hover:bg-[var(--bg-pill-hover)] text-[var(--text-primary)] shadow-xl backdrop-blur-md transition-all cursor-pointer select-none active:scale-95"
                >
                  <ArrowDown className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Bottom Floating Input Capsule */}
            <div className="p-4 sm:pb-6 sm:px-8 flex-shrink-0 flex justify-center w-full">
              {renderInputCapsule(false)}
            </div>
          </div>
        )}
      </main>

      {/* Global In-UI Search Modal (Cmd+K) */}
      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelectSession={handleSelectSession}
        onSearch={api.searchMessages}
      />

      {/* Hindsight Memory Inspector Modal (Cmd+M) */}
      <MemoryInspectorModal
        isOpen={isMemoryInspectorOpen}
        onClose={() => setIsMemoryInspectorOpen(false)}
        isBackendOnline={isBackendOnline}
      />
    </div>
  );
}

export default App;
