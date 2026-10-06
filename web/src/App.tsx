import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ArrowUp,
  Square,
  ArrowDown,
  ArrowLeft,
  LineSquiggle,
  Sparkles,
  Plus,
  Sun,
  Moon,
} from 'lucide-react';
import type {
  ChatMessage,
  ThinkingEffort,
  RecallBudget,
  Verbosity,
  SupportedModel,
  ActiveFlyout,
  ThreadItem,
  Session,
  Artifact,
  ThreadProposal,
  StagedAction,
  Skill,
} from './types';
import * as api from './api';
import { NavigationRail } from './components/NavigationRail';
import { OptionsMenu } from './components/OptionsMenu';
import { ChatMessageView } from './components/ChatMessageView';
import { ArtifactCanvas } from './components/ArtifactCanvas';
import { VelocityWordmark } from './components/VelocityWordmark';
import { CommandOmnibar } from './components/CommandOmnibar';
import { MemoryInspectorModal } from './components/MemoryInspectorModal';
import { SettingsModal } from './components/SettingsModal';
import { getGreetingForCurrentTime } from './utils/greetings';

export function App() {
  // Session & Thread state: default to 'main' lifelong continuous timeline
  const [currentSessionId, setCurrentSessionId] = useState<string>('main');
  const [activeThread, setActiveThread] = useState<ThreadItem | null>(null);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isBackendOnline, setIsBackendOnline] = useState(true);
  const [healthDetails, setHealthDetails] = useState<api.HealthDetails | null>(null);

  // Artifact Canvas State
  const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null);
  const [isCanvasOpen, setIsCanvasOpen] = useState(false);
  const [canvasWidth, setCanvasWidth] = useState(620);

  // Floating Approvals State (Derived reactively from messages - never disappears prematurely)
  const pendingProposal = messages.reduceRight<{ messageId: string; proposal: ThreadProposal } | null>((acc, m) => {
    if (acc) return acc;
    if (m.thread_proposal) {
      let prop: ThreadProposal | null = null;
      if (typeof m.thread_proposal === 'object') {
        prop = m.thread_proposal;
      } else {
        try {
          prop = JSON.parse(m.thread_proposal);
        } catch {
          prop = null;
        }
      }
      if (prop && (!prop.status || prop.status === 'pending')) {
        return { messageId: m.id, proposal: prop };
      }
    }
    return null;
  }, null);

  const pendingAction = messages.reduceRight<StagedAction | null>((acc, m) => {
    if (acc) return acc;
    if (m.staged_action && m.staged_action.status === 'pending') {
      return m.staged_action;
    }
    return null;
  }, null);

  // Navigation Rail & Flyouts
  const [activeFlyout, setActiveFlyout] = useState<ActiveFlyout>('none');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMemoryInspectorOpen, setIsMemoryInspectorOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'general' | 'plugins' | 'memory' | 'schedules' | 'skills'>('general');
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const isUserScrolledUpRef = useRef(false);

  // Dynamic Greeting state (contextual by time of day)
  const [greeting, setGreeting] = useState<string>(() => getGreetingForCurrentTime());

  // Dark/Light/OLED Theme state
  const [theme, setTheme] = useState<'dark' | 'light' | 'oled'>(() => {
    return (localStorage.getItem('velocity-theme') as 'dark' | 'light' | 'oled') || 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('oled', theme === 'oled');
    if (theme === 'light') {
      root.classList.add('light');
      root.classList.remove('dark');
    } else {
      root.classList.add('dark');
      root.classList.remove('light');
    }
    localStorage.setItem('velocity-theme', theme);
  }, [theme]);

  // Skills state for slash autocomplete
  const [installedSkills, setInstalledSkills] = useState<Skill[]>([]);
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [isSlashOpen, setIsSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [selectedSlashIdx, setSelectedSlashIdx] = useState(0);

  const loadThreads = useCallback(async () => {
    try {
      const res = await api.listThreads();
      setThreads(res.threads || []);
    } catch (e) {
      console.error('Failed to load threads:', e);
    }
  }, []);

  const handleToggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'oled' ? 'dark' : prev === 'dark' ? 'light' : 'oled'));
  }, []);

  useEffect(() => {
    api.listSkills().then(setInstalledSkills).catch(() => {});
    loadThreads();
  }, [loadThreads]);

  // Check URL query parameters on mount (e.g. redirected from Google OAuth callback)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const settingsParam = params.get('settings');
    const connectedParam = params.get('connected');
    const errorParam = params.get('error');
    if (settingsParam || connectedParam || errorParam) {
      if (['plugins', 'general', 'memory', 'schedules', 'skills'].includes(settingsParam || '')) {
        setSettingsTab(settingsParam as any);
      } else {
        setSettingsTab('plugins');
      }
      if (errorParam) {
        setSettingsError(errorParam);
      }
      setIsSettingsOpen(true);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Real-time proactive events stream with exponential backoff reconnect
  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectTimeout: any = null;
    let retryDelay = 1000;

    const connectSSE = () => {
      try {
        eventSource = new EventSource('/api/stream/events');
        eventSource.onopen = () => {
          retryDelay = 1000;
        };
        eventSource.addEventListener('proactive_event', (e) => {
          try {
            const payload = JSON.parse(e.data);
            const msg = payload.message;
            if (msg && (payload.session_id === 'main' || payload.session_id === activeSession?.id)) {
              setMessages((prev) => {
                if (prev.some((m) => m.id === msg.id)) return prev;
                return [...prev, msg];
              });
              setTimeout(() => {
                if (chatScrollRef.current) {
                  chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
                }
              }, 100);
            }
          } catch (err) {
            console.error('Failed to parse proactive event:', err);
          }
        });
        eventSource.onerror = () => {
          if (eventSource) eventSource.close();
          retryDelay = Math.min(retryDelay * 2, 30000);
          reconnectTimeout = setTimeout(connectSSE, retryDelay);
        };
      } catch (err) {
        console.error('Failed to connect to proactive event stream:', err);
        retryDelay = Math.min(retryDelay * 2, 30000);
        reconnectTimeout = setTimeout(connectSSE, retryDelay);
      }
    };

    connectSSE();

    return () => {
      if (eventSource) eventSource.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [activeSession?.id]);

  // Options Popover & Model Preferences
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

  const handleScroll = useCallback(() => {
    if (!chatScrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = chatScrollRef.current;
    const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
    const scrolledUp = distanceFromBottom > 60;
    isUserScrolledUpRef.current = scrolledUp;
    setIsUserScrolledUp(scrolledUp);
  }, []);

  const scrollToBottom = useCallback((force: boolean = false) => {
    if (chatScrollRef.current) {
      if (!force && isUserScrolledUpRef.current) return;
      chatScrollRef.current.scrollTo({
        top: chatScrollRef.current.scrollHeight,
        behavior: force ? 'auto' : 'smooth',
      });
    }
  }, []);

  useEffect(() => {
    if (isStreaming && !isUserScrolledUpRef.current) {
      scrollToBottom();
    }
  }, [messages, isStreaming, scrollToBottom]);

  const isStreamingRef = useRef(false);
  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  // Switch session: loads history for 'main' timeline or specific thread
  const searchTargetRef = useRef<{ sessionId: string; messageId: string } | null>(null);
  const [highlightedMessage, setHighlightedMessage] = useState<string | null>(null);
  useEffect(() => {
    const target = searchTargetRef.current;
    if (!target || target.sessionId !== currentSessionId) return;
    const element = document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(target.messageId)}"]`);
    if (!element) return;
    isUserScrolledUpRef.current = true;
    setIsUserScrolledUp(true);
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setHighlightedMessage(target.messageId);
    searchTargetRef.current = null;
  }, [messages, currentSessionId]);
  useEffect(() => {
    if (!highlightedMessage) return;
    const timer = window.setTimeout(() => setHighlightedMessage(null), 4000);
    return () => window.clearTimeout(timer);
  }, [highlightedMessage]);
  const handleSelectSession = useCallback(async (sessionId: string) => {
    if (isStreamingRef.current) return;
    const target = sessionId || 'main';
    localStorage.setItem('velocity-active-session', target);
    setCurrentSessionId(target);
    isUserScrolledUpRef.current = false;
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
        setActiveSession(session);
        setSelectedModel(session.model || 'gpt-5.4-mini');
        setThinkingEffort(session.thinking_effort || 'medium');
        setRecallBudget(session.recall_budget || 'medium');
        setVerbosity(session.verbosity || 'low');
      } else {
        setActiveSession(null);
      }
      setMessages(history);
      if (!searchTargetRef.current) setTimeout(() => { if (!isUserScrolledUpRef.current) scrollToBottom(true); }, 50);
    } catch (err) {
      console.error(`Failed to load session messages for '${target}':`, err);
      if (target !== 'main') {
        localStorage.setItem('velocity-active-session', 'main');
        setCurrentSessionId('main');
        setActiveThread(null);
        try {
          const { session, messages: history } = await api.getSessionMessages('main');
          if (session) {
            setActiveSession(session);
            setSelectedModel(session.model || 'gpt-5.4-mini');
            setThinkingEffort(session.thinking_effort || 'medium');
            setRecallBudget(session.recall_budget || 'medium');
            setVerbosity(session.verbosity || 'low');
          } else {
            setActiveSession(null);
          }
          setMessages(history);
          setTimeout(() => scrollToBottom(true), 50);
        } catch {
          setMessages([]);
          setActiveSession(null);
        }
        return;
      }
      setMessages([]);
      setActiveSession(null);
    }
  }, [scrollToBottom]);

  // Initial Load & Health Polling
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Frictionless Side Chat Exit: automatically trigger background rollup
  const handleExitThread = useCallback(async () => {
    if (activeThread) {
      api.triggerThreadRollup(activeThread.id, false).catch((err) => {
        console.error('Background rollup error:', err);
      });
    }
    handleSelectSession('main');
  }, [activeThread, handleSelectSession]);

  // Global keyboard shortcuts: Cmd+K (Search), Cmd+M (Memory Vault), Esc (Dismiss)
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
        setIsSlashOpen(false);
        setActiveFlyout('none');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleUpdateModel = async (newModel: SupportedModel) => {
    setSelectedModel(newModel);
    localStorage.setItem('velocity-preferred-model', newModel);
    if (currentSessionId) {
      try {
        await api.updateSession(currentSessionId, { model: newModel });
      } catch (err) {
        console.error('Failed to update model:', err);
      }
    }
  };

  const handleUpdateEffort = async (newEffort: ThinkingEffort) => {
    setThinkingEffort(newEffort);
    if (currentSessionId) {
      try {
        await api.updateSession(currentSessionId, { thinking_effort: newEffort });
      } catch (err) {
        console.error('Failed to update effort:', err);
      }
    }
  };

  const handleUpdateRecall = async (newRecall: RecallBudget) => {
    setRecallBudget(newRecall);
    if (currentSessionId) {
      try {
        await api.updateSession(currentSessionId, { recall_budget: newRecall });
      } catch (err) {
        console.error('Failed to update recall:', err);
      }
    }
  };

  const handleUpdateVerbosity = async (newVerbosity: Verbosity) => {
    setVerbosity(newVerbosity);
    if (currentSessionId) {
      try {
        await api.updateSession(currentSessionId, { verbosity: newVerbosity });
      } catch (err) {
        console.error('Failed to update verbosity:', err);
      }
    }
  };

  // Slash commands list
  const slashItems = [
    { command: '/thread', label: '/thread [topic]', desc: 'Branch a dedicated thread', icon: LineSquiggle },
    { command: '/briefing', label: '/briefing', desc: 'Synthesize proactive morning briefing', icon: Sun },
    { command: '/reflection', label: '/reflection', desc: 'Synthesize evening reflection routine', icon: Moon },
    ...installedSkills.map((sk) => ({
      command: sk.slash_command || `/${sk.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      label: sk.slash_command || `/${sk.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      desc: sk.description,
      icon: Sparkles,
    })),
  ].filter((item) => item.command.toLowerCase().includes(slashQuery.toLowerCase()));

  // Send message turn with Atomic Delivery on main timeline
  const handleSendMessage = async (textToSend?: string) => {
    const rawText = (textToSend || inputValue).trim();
    if (!rawText || isStreaming) return;

    setInputValue('');
    setIsSlashOpen(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    setIsOptionsOpen(false);

    // Intercept /thread [topic] slash command
    if (rawText.startsWith('/thread')) {
      const topic = rawText.replace(/^\/thread\s*/, '').trim() || 'Engineering Investigation';
      try {
        const created = await api.createThread({
          name: topic,
          parent_session_id: 'main',
        });
        handleSelectSession(created.id);
        return;
      } catch (err) {
        console.error('Failed to create thread:', err);
      }
    }

    const targetSessionId = currentSessionId || 'main';
    const isMainThread = targetSessionId === 'main' || (!activeThread && !activeSession?.is_thread);

    const userMsgId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `user-${Date.now()}`;
    const asstMsgId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `asst-${Date.now()}`;

    const userMsg: ChatMessage = {
      id: userMsgId,
      session_id: targetSessionId,
      role: 'user',
      content: rawText,
      created_at: new Date().toISOString(),
    };

    const asstMsg: ChatMessage = {
      id: asstMsgId,
      session_id: targetSessionId,
      role: 'assistant',
      content: '',
      isStreaming: true,
      statusText: isMainThread ? undefined : 'Thinking',
      reasoning: '',
      toolCalls: [],
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg, asstMsg]);
    setIsStreaming(true);
    isUserScrolledUpRef.current = false;
    setIsUserScrolledUp(false);
    setTimeout(() => scrollToBottom(true), 20);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      await api.streamChatTurn(
        {
          sessionId: targetSessionId,
          message: rawText,
          messageId: userMsgId,
          recallBudget,
          thinkingEffort,
          verbosity,
          model: selectedModel,
        },
        {
          onStatus: (statusText) => {
            if (!isMainThread) {
              setMessages((prev) =>
                prev.map((m) => (m.id === asstMsgId ? { ...m, statusText } : m))
              );
            }
          },
          onAgenticStep: (step) => {
            if (!isMainThread) {
              setMessages((prev) =>
                prev.map((m) => (m.id === asstMsgId ? { ...m, agenticStep: step } : m))
              );
            }
          },
          onReasoningDelta: (deltaText) => {
            if (!isMainThread) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === asstMsgId
                    ? { ...m, reasoning: (m.reasoning || '') + deltaText }
                    : m
                )
              );
            }
          },
          onThreadProposal: (proposal) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === asstMsgId ? { ...m, thread_proposal: proposal } : m
              )
            );
          },
          onArtifactCreated: (art) => {
            setActiveArtifact(art);
          },
          onActionProposal: (action) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === asstMsgId ? { ...m, staged_action: action } : m
              )
            );
          },
          onDelta: (deltaText) => {
            if (!isMainThread) {
              // Side chat: real-time live streaming
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === asstMsgId
                    ? { ...m, content: m.content + deltaText }
                    : m
                )
              );
            }
          },
          onComplete: (data) => {
            // Atomic delivery for main timeline: lands complete response all at once
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
                    artifact: data.artifact || m.artifact,
                    artifact_id: data.artifact_id || m.artifact_id,
                    staged_action: data.staged_action || m.staged_action,
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
            if (data.artifact) {
              setActiveArtifact(data.artifact);
            }
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

  // Floating Proposal Handlers
  const handleAcceptProposal = useCallback(async (messageId: string) => {
    try {
      const res = await api.respondToThreadProposal(messageId, 'accept');
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, thread_proposal: res.proposal } : m
        )
      );
      if (res.thread) {
        handleSelectSession(res.thread.id);
      }
    } catch (err) {
      console.error('Failed to accept proposal:', err);
    }
  }, [handleSelectSession]);

  const handleDeclineProposal = useCallback(async (messageId: string) => {
    try {
      const res = await api.respondToThreadProposal(messageId, 'decline');
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, thread_proposal: res.proposal } : m
        )
      );
      handleSendMessage('Please continue directly here in the main timeline.');
    } catch (err) {
      console.error('Failed to decline proposal:', err);
    }
  }, []);

  // Floating Action Handlers (e.g. Gmail)
  const handleRespondAction = useCallback(async (actionId: string, decision: 'confirm' | 'decline') => {
    try {
      const updated = await api.respondToStagedAction(actionId, decision);
      setMessages((prev) =>
        prev.map((m) =>
          m.staged_action && m.staged_action.id === actionId
            ? { ...m, staged_action: updated }
            : m
        )
      );
    } catch (err) {
      console.error('Failed to respond to staged action:', err);
    }
  }, []);

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

  const formatDateDivider = (timestamp?: string) => {
    if (!timestamp) return '';
    try {
      const date = new Date(timestamp);
      const now = new Date();
      if (date.toDateString() === now.toDateString()) return 'Today';
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
      return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  // Render input capsule with docked floating approval cards and slash command autocomplete
  const renderInputCapsule = (isCentered: boolean = false) => (
    <div
      className={`relative w-full ${
        isCentered ? 'max-w-2xl sm:max-w-3xl' : 'max-w-3xl'
      } flex flex-col items-center select-none`}
    >
      {/* 1. Floating Approval Card for Thread Proposal */}
      {pendingProposal && (
        <div className="w-full mb-3 px-4 py-3 bg-[var(--bg-card)] rounded-2xl flex items-center justify-between gap-4 shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[var(--accent-soft)] text-[var(--accent-violet)] flex items-center justify-center flex-shrink-0">
              <LineSquiggle className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--text-primary)] truncate">
                {pendingProposal.proposal.title}
              </div>
              <div className="text-xs text-[var(--text-muted)] truncate">
                {pendingProposal.proposal.reason || 'Proposed Thread'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => handleDeclineProposal(pendingProposal.messageId)}
              className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-pill)] active:scale-95 transition-all"
            >
              Continue Here
            </button>
            <button
              type="button"
              onClick={() => handleAcceptProposal(pendingProposal.messageId)}
              className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-[var(--text-primary)] text-[var(--bg-primary)] hover:opacity-85 active:scale-95 transition-all"
            >
              Approve
            </button>
          </div>
        </div>
      )}

      {/* 2. Floating Approval Card for Controlled Action (Gmail) */}
      {pendingAction && (
        <div className="w-full mb-3 px-4 py-3 bg-[var(--bg-card)] rounded-2xl flex items-center justify-between gap-4 shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[var(--accent-soft)] text-[var(--accent-amber)] flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--text-primary)] truncate">
                {pendingAction.action_type.replace(/_/g, ' ').toUpperCase()}: {pendingAction.parameters?.subject || pendingAction.parameters?.to || 'Action'}
              </div>
              <div className="text-xs text-[var(--text-muted)] truncate">Requires your approval to send</div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => handleRespondAction(pendingAction.id, 'decline')}
              className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-pill)] active:scale-95 transition-all"
            >
              Decline
            </button>
            <button
              type="button"
              onClick={() => handleRespondAction(pendingAction.id, 'confirm')}
              className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-[var(--text-primary)] text-[var(--bg-primary)] hover:opacity-85 active:scale-95 transition-all"
            >
              Approve
            </button>
          </div>
        </div>
      )}

      {/* 3. Slash Command Autocomplete Palette */}
      {isSlashOpen && slashItems.length > 0 && (
        <div className="absolute bottom-full left-0 mb-3 w-84 rounded-2xl bg-[var(--bg-card)] p-2 shadow-2xl z-50 text-[var(--text-primary)] select-none animate-in fade-in duration-150">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-dim)] px-3 py-1">
            Skills & Commands
          </div>
          <div className="space-y-0.5">
            {slashItems.map((item, idx) => {
              const IconComp = (item as any).icon || Sparkles;
              return (
                <div
                  key={item.command}
                  onClick={() => {
                    setInputValue(`${item.command} `);
                    setIsSlashOpen(false);
                    textareaRef.current?.focus();
                  }}
                  className={`flex items-center gap-2.5 p-2 rounded-xl cursor-pointer active:scale-[0.98] transition-all ${
                    idx === selectedSlashIdx ? 'bg-[var(--bg-card-hover)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card)]'
                  }`}
                >
                  <div className="w-6 h-6 rounded-lg bg-white/5 flex items-center justify-center shrink-0 text-[var(--text-muted)]">
                    <IconComp className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[var(--text-primary)]">{item.label}</div>
                    <div className="text-[11px] text-[var(--text-muted)] truncate">{item.desc}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Options Menu Popover */}
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

      {/* Flat Input Capsule - Strictly Zero Borders */}
      <div className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-[26px] bg-[var(--bg-card)] shadow-2xl transition-all">
        <button
          id="options-toggle-btn"
          type="button"
          onClick={() => setIsOptionsOpen(!isOptionsOpen)}
          title="Configure Effort, Recall & Model"
          className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 bg-[var(--bg-card-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] active:scale-95 transition-all"
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
            const val = e.target.value;
            setInputValue(val);
            if (val.startsWith('/')) {
              setSlashQuery(val.slice(1));
              setIsSlashOpen(true);
              setSelectedSlashIdx(0);
            } else {
              setIsSlashOpen(false);
            }
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(160, Math.max(24, e.target.scrollHeight))}px`;
          }}
          onKeyDown={(e) => {
            if (isSlashOpen && slashItems.length > 0) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedSlashIdx((prev) => (prev + 1) % slashItems.length);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedSlashIdx((prev) => (prev - 1 + slashItems.length) % slashItems.length);
                return;
              }
              if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                e.preventDefault();
                setInputValue(`${slashItems[selectedSlashIdx].command} `);
                setIsSlashOpen(false);
                return;
              }
              if (e.key === 'Escape') {
                setIsSlashOpen(false);
                return;
              }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSendMessage();
            }
          }}
          placeholder={
            activeThread
              ? `Message in ${activeThread.name}...`
              : 'Message Velocity...'
          }
          rows={1}
          className="flex-1 bg-transparent text-[15.5px] font-medium text-[var(--text-primary)] placeholder-neutral-500 outline-none resize-none py-1.5 px-1 leading-snug max-h-40 border-none"
        />

        {isStreaming ? (
          <button
            type="button"
            onClick={handleStopStreaming}
            title="Stop generating"
            className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 bg-[var(--text-primary)] text-[var(--bg-primary)] hover:opacity-90 active:scale-95 transition-all"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => handleSendMessage()}
            disabled={!inputValue.trim()}
            title="Send message"
            className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 active:scale-95 transition-all ${
              inputValue.trim()
                ? 'bg-[var(--text-primary)] text-[var(--bg-primary)] hover:opacity-90'
                : 'bg-[var(--bg-card-hover)] text-[var(--text-dim)] cursor-not-allowed'
            }`}
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-card)] text-[var(--text-primary)] font-sans">
      {/* 1. Centered 5-Icon Navigation Rail */}
      <NavigationRail
        currentSessionId={currentSessionId}
        activeFlyout={activeFlyout}
        onSelectFlyout={setActiveFlyout}
        onSelectSession={handleSelectSession}
        onSelectMessage={(sessionId, messageId) => {
          if (isStreamingRef.current) return;
          searchTargetRef.current = { sessionId, messageId };
          void handleSelectSession(sessionId);
        }}
        onOpenArtifact={(art) => {
          setActiveArtifact(art);
          setIsCanvasOpen(true);
        }}
        onOpenMemoryInspector={() => {
          setSettingsTab('memory');
          setIsSettingsOpen(true);
        }}
        onOpenSettings={() => {
          setSettingsTab('general');
          setIsSettingsOpen(true);
        }}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        isBackendOnline={isBackendOnline}
        healthDetails={healthDetails}
      />

      {/* 2. Main Timeline / Side Chat Area */}
      <main className="flex-1 flex flex-col h-full min-w-0 relative bg-[var(--bg-card)]">
        {/* Top Header - Bolder Centered Velocity Logo & Frictionless Thread Navigation */}
        <header className="relative z-20 h-14 bg-[var(--bg-card)] flex items-center justify-between px-6 flex-shrink-0 select-none">
          {activeThread ? (
            /* Thread Top Bar */
            <div className="flex items-center justify-between w-full">
              <button
                type="button"
                onClick={handleExitThread}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] active:scale-95 transition-all"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Main Timeline</span>
              </button>

              <div className="flex items-center gap-2">
                <LineSquiggle className="w-4 h-4 text-[var(--accent-violet)]" />
                <h2 className="text-sm font-semibold text-[var(--text-primary)] truncate max-w-[280px] sm:max-w-md">
                  {activeThread.name}
                </h2>
              </div>

              <div className="w-24" />
            </div>
          ) : (
            /* Main Continuous Timeline Top Bar - Bolder Logo Centered */
            <div className="flex items-center justify-center w-full relative">
              <div className="flex items-center gap-2">
                <VelocityWordmark />
              </div>
            </div>
          )}
        </header>

        {/* Conversation Stream vs. Centered Empty State */}
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
            <div className="relative flex-1 min-h-0 flex flex-col">
            <div
              ref={chatScrollRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto px-4 sm:px-8 pt-5 pb-4 sm:pt-6 sm:pb-6 flex flex-col justify-start"
            >
              <div className="w-full max-w-3xl mx-auto flex flex-col flex-1">
                {messages.map((msg, idx) => {
                  const prevMsg = idx > 0 ? messages[idx - 1] : null;
                  const isNewDay = !prevMsg || new Date(msg.created_at).toDateString() !== new Date(prevMsg.created_at).toDateString();
                  return (
                    <div key={msg.id} data-message-id={msg.id} className={`w-full flex flex-col ${highlightedMessage === msg.id ? 'message-search-target' : ''}`}>
                      {isNewDay && (
                        <div className="w-full flex items-center justify-center my-2.5 select-none">
                          <span className="text-[11px] font-medium text-[var(--text-dim)] uppercase tracking-wider">
                            {formatDateDivider(msg.created_at)}
                          </span>
                        </div>
                      )}
                      <ChatMessageView
                        message={msg}
                        isThread={currentSessionId !== 'main' && (Boolean(activeThread) || Boolean(activeSession?.is_thread))}
                        onEditAndResend={handleEditAndResend}
                        onRegenerate={handleRegenerate}
                        onOpenThread={(threadId) => handleSelectSession(threadId)}
                        onOpenArtifact={(art) => {
                          setActiveArtifact(art);
                          setIsCanvasOpen(true);
                        }}
                        onRespondProposal={handleAcceptProposal}
                        onRespondAction={handleRespondAction}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Scroll to Bottom Button */}
            {isUserScrolledUp && (
              <div className="absolute bottom-4 right-5 sm:right-10 z-30 animate-fade-in pointer-events-auto">
                <button
                  type="button"
                  onClick={() => {
                    isUserScrolledUpRef.current = false;
                    setIsUserScrolledUp(false);
                    scrollToBottom(true);
                  }}
                  title="Jump to latest"
                  aria-label="Jump to latest"
                  className="w-12 h-12 rounded-full flex items-center justify-center bg-[var(--bg-card-hover)] hover:bg-[var(--bg-card-hover)] text-[var(--text-primary)] shadow-xl transition-all cursor-pointer select-none active:scale-95"
                >
                  <ArrowDown className="w-4 h-4" />
                </button>
              </div>
            )}
            </div>

            {/* Bottom Floating Input Capsule */}
            <div className="p-3 sm:pb-5 sm:px-8 flex-shrink-0 flex justify-center w-full">
              {renderInputCapsule(false)}
            </div>
          </div>
        )}
      </main>

      {/* 3. Artifact Canvas Side-by-Side Panel */}
      <ArtifactCanvas
        artifact={activeArtifact}
        onUpdate={setActiveArtifact}
        isOpen={isCanvasOpen}
        onClose={() => setIsCanvasOpen(false)}
        width={canvasWidth}
        onWidthChange={setCanvasWidth}
      />

      {/* Global In-UI Command Omnibar (Cmd+K) */}
      <CommandOmnibar
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelectSession={handleSelectSession}
        currentSessionId={currentSessionId}
        onSelectMessage={(sessionId, messageId) => {
          if (isStreamingRef.current) return;
          searchTargetRef.current = { sessionId, messageId };
          void handleSelectSession(sessionId);
        }}
        onOpenArtifact={artifact => { setActiveArtifact(artifact); setIsCanvasOpen(true); }}
        onSearch={api.searchMessages}
        onTriggerRoutine={(routine) => {
          if (routine === 'briefing') {
            handleSendMessage('Generate my morning briefing.');
          } else {
            handleSendMessage('Synthesize my evening reflection.');
          }
        }}
        onOpenSettings={() => {
          setSettingsTab('general');
          setIsSettingsOpen(true);
        }}
        onOpenMemoryInspector={() => setIsMemoryInspectorOpen(true)}
        onToggleCanvas={() => setIsCanvasOpen((prev) => !prev)}
        onToggleTheme={handleToggleTheme}
        threads={threads}
      />

      {/* Hindsight Memory Inspector Modal (Cmd+M) */}
      <MemoryInspectorModal
        isOpen={isMemoryInspectorOpen}
        onClose={() => setIsMemoryInspectorOpen(false)}
        isBackendOnline={isBackendOnline}
      />

      {/* Claude-Style Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => {
          setIsSettingsOpen(false);
          setSettingsError(null);
        }}
        initialTab={settingsTab}
        initialError={settingsError}
        currentModel={selectedModel}
        onSelectModel={handleUpdateModel}
        currentEffort={thinkingEffort}
        onSelectEffort={handleUpdateEffort}
        currentVerbosity={verbosity}
        onSelectVerbosity={handleUpdateVerbosity}
        currentRecallBudget={recallBudget}
        onSelectRecallBudget={handleUpdateRecall}
        theme={theme}
        onSelectTheme={setTheme}
      />
    </div>
  );
}

export default App;
