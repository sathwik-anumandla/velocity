import { useState, useEffect, useRef } from 'react';
import type { FC, MouseEvent } from 'react';
import {
  GitBranch,
  Search,
  Link2,
  Clock,
  Image as ImageIcon,
  Brain,
  Sun,
  Moon,
  Plus,
  X,
  ExternalLink,
  CheckCircle2,
  RotateCcw,
} from 'lucide-react';
import type { ActiveFlyout, ThreadItem, NavigationLink, ChronologyEvent } from '../types';
import * as api from '../api';
import type { HealthDetails } from '../api';

interface NavigationRailProps {
  currentSessionId: string | null;
  activeFlyout: ActiveFlyout;
  onSelectFlyout: (flyout: ActiveFlyout) => void;
  onSelectSession: (sessionId: string) => void;
  onOpenMemoryInspector: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  isBackendOnline: boolean;
  healthDetails?: HealthDetails | null;
}

export const NavigationRail: FC<NavigationRailProps> = ({
  currentSessionId,
  activeFlyout,
  onSelectFlyout,
  onSelectSession,
  onOpenMemoryInspector,
  theme,
  onToggleTheme,
  isBackendOnline,
  healthDetails,
}) => {
  // Flyout data states
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [links, setLinks] = useState<NavigationLink[]>([]);
  const [chronology, setChronology] = useState<ChronologyEvent[]>([]);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [threadFilter, setThreadFilter] = useState<'all' | 'active' | 'concluded'>('all');

  // New Thread creation inline state
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [newThreadTitle, setNewThreadTitle] = useState('');

  // Status popup state
  const [isStatusOpen, setIsStatusOpen] = useState(false);
  const [fetchedHealth, setFetchedHealth] = useState<HealthDetails | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  const health = fetchedHealth || healthDetails;
  const isHealthy = health ? health.status === 'ok' : isBackendOnline;

  // Load threads when flyout is open or on mount
  const refreshThreads = async () => {
    try {
      const res = await api.listThreads();
      setThreads(res.threads || []);
    } catch (e) {
      console.error('Failed to load threads:', e);
    }
  };

  // Load links
  const refreshLinks = async () => {
    try {
      const res = await api.getNavigationLinks(60);
      setLinks(res.links || []);
    } catch (e) {
      console.error('Failed to load links:', e);
    }
  };

  // Load chronology
  const refreshChronology = async () => {
    try {
      const res = await api.getNavigationChronology(60);
      setChronology(res.events || []);
    } catch (e) {
      console.error('Failed to load chronology:', e);
    }
  };

  useEffect(() => {
    refreshThreads();
  }, [currentSessionId]);

  useEffect(() => {
    if (activeFlyout === 'threads') {
      refreshThreads();
    } else if (activeFlyout === 'links') {
      refreshLinks();
    } else if (activeFlyout === 'chronology') {
      refreshChronology();
    }
  }, [activeFlyout]);

  // Live search debounced
  useEffect(() => {
    if (activeFlyout !== 'search' || !searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await api.searchMessages(searchQuery.trim());
        setSearchResults(results || []);
      } catch (e) {
        console.error('Search failed:', e);
      } finally {
        setIsSearching(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [searchQuery, activeFlyout]);

  // Status popover outside click
  useEffect(() => {
    if (!isStatusOpen) return;
    const handleClick = (e: MouseEvent | any) => {
      if (statusRef.current && !statusRef.current.contains(e.target as Node)) {
        setIsStatusOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isStatusOpen]);

  const handleToggleStatus = async () => {
    const next = !isStatusOpen;
    setIsStatusOpen(next);
    if (next) {
      try {
        const details = await api.getHealthDetails();
        setFetchedHealth(details);
      } catch (e) {
        console.error('Failed to refresh health:', e);
      }
    }
  };

  const handleCreateNewThread = async () => {
    if (!newThreadTitle.trim()) {
      setIsCreatingThread(false);
      return;
    }
    try {
      const created = await api.createThread({
        name: newThreadTitle.trim(),
        parent_session_id: 'main',
      });
      setNewThreadTitle('');
      setIsCreatingThread(false);
      await refreshThreads();
      onSelectSession(created.id);
      onSelectFlyout('none');
    } catch (e) {
      console.error('Failed to create thread:', e);
    }
  };

  const handleConcludeThread = async (threadId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.triggerThreadRollup(threadId, true);
      await refreshThreads();
    } catch (err) {
      console.error('Failed to conclude thread:', err);
    }
  };

  const handleReopenThread = async (threadId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.updateThread(threadId, { status: 'active' });
      await refreshThreads();
    } catch (err) {
      console.error('Failed to reopen thread:', err);
    }
  };

  const activeThreadsCount = threads.filter((t) => t.status === 'active').length;

  const filteredThreads = threads.filter((t) => {
    if (threadFilter === 'active') return t.status === 'active';
    if (threadFilter === 'concluded') return t.status === 'concluded';
    return true;
  });

  const formatTimestamp = (ts: string) => {
    if (!ts) return '';
    try {
      const date = new Date(ts);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffMins < 1) return 'just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  return (
    <div className="flex h-full select-none shrink-0 z-30">
      {/* 1. Narrow Vertical Rail (64px) */}
      <nav className="w-16 h-full bg-[#000000] border-r border-zinc-800/80 flex flex-col items-center py-3.5 justify-between">
        {/* Top: Logo & Main Lifelong Timeline */}
        <div className="flex flex-col items-center gap-4 w-full">
          <button
            type="button"
            onClick={() => {
              onSelectSession('main');
              onSelectFlyout('none');
            }}
            title="Main Lifelong Timeline"
            className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-all ${
              currentSessionId === 'main' && activeFlyout === 'none'
                ? 'bg-zinc-100 text-zinc-950 font-bold shadow-sm ring-2 ring-zinc-100/20'
                : 'bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 hover:text-white'
            }`}
          >
            <span className="text-base font-extrabold tracking-tighter">V</span>
          </button>

          <div className="w-8 h-[1px] bg-zinc-800/60 my-0.5" />

          {/* Navigation Action Buttons */}
          <div className="flex flex-col items-center gap-2 w-full px-2">
            {/* Threads (Side Chats) */}
            <button
              type="button"
              onClick={() => onSelectFlyout(activeFlyout === 'threads' ? 'none' : 'threads')}
              title="Side Chats (Threads)"
              className={`relative w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${
                activeFlyout === 'threads'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900/80'
              }`}
            >
              <GitBranch className="w-5 h-5" />
              {activeThreadsCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-[#000000]" />
              )}
            </button>

            {/* Search */}
            <button
              type="button"
              onClick={() => onSelectFlyout(activeFlyout === 'search' ? 'none' : 'search')}
              title="Search Messages"
              className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${
                activeFlyout === 'search'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900/80'
              }`}
            >
              <Search className="w-5 h-5" />
            </button>

            {/* Links */}
            <button
              type="button"
              onClick={() => onSelectFlyout(activeFlyout === 'links' ? 'none' : 'links')}
              title="Shared Links"
              className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${
                activeFlyout === 'links'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900/80'
              }`}
            >
              <Link2 className="w-5 h-5" />
            </button>

            {/* Chronology */}
            <button
              type="button"
              onClick={() => onSelectFlyout(activeFlyout === 'chronology' ? 'none' : 'chronology')}
              title="Chronology (Unified Timeline)"
              className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${
                activeFlyout === 'chronology'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900/80'
              }`}
            >
              <Clock className="w-5 h-5" />
            </button>

            {/* Images (Phase 6 Placeholder) */}
            <button
              type="button"
              disabled
              title="Images (Coming in Phase 6)"
              className="w-11 h-11 rounded-xl flex items-center justify-center text-zinc-600 cursor-not-allowed opacity-50"
            >
              <ImageIcon className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Bottom Actions: Memory Vault, Theme, Health */}
        <div className="flex flex-col items-center gap-3 w-full px-2">
          {/* Deterministic Memory Vault Explorer */}
          <button
            type="button"
            onClick={onOpenMemoryInspector}
            title="Deterministic Memory Vault"
            className="w-11 h-11 rounded-xl flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900/80 transition-colors"
          >
            <Brain className="w-5 h-5" />
          </button>

          {/* Theme Toggle */}
          <button
            type="button"
            onClick={onToggleTheme}
            title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
            className="w-11 h-11 rounded-xl flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900/80 transition-colors"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* System Health Dot */}
          <div className="relative" ref={statusRef}>
            <button
              type="button"
              onClick={handleToggleStatus}
              title={`System Status: ${isHealthy ? 'Healthy' : 'Degraded'}`}
              className="w-11 h-11 rounded-xl flex items-center justify-center hover:bg-zinc-900/80 transition-colors"
            >
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  isHealthy ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]'
                }`}
              />
            </button>

            {/* Health Popup Modal */}
            {isStatusOpen && (
              <div className="absolute bottom-2 left-16 ml-3 w-72 bg-zinc-950 border border-zinc-800 rounded-2xl p-4 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-150">
                <div className="flex items-center justify-between pb-2.5 border-b border-zinc-800/80">
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">System Health</span>
                  <span
                    className={`text-[11px] font-mono px-2 py-0.5 rounded-full border ${
                      isHealthy
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    }`}
                  >
                    {isHealthy ? 'Operational' : 'Degraded'}
                  </span>
                </div>
                <div className="mt-3 space-y-2 text-xs">
                  <div className="flex justify-between items-center text-zinc-300">
                    <span className="text-zinc-500">FastAPI Backend</span>
                    <span className="font-mono text-emerald-400">{health?.backend || 'connected'}</span>
                  </div>
                  <div className="flex justify-between items-center text-zinc-300">
                    <span className="text-zinc-500">Hindsight Engine</span>
                    <span className="font-mono text-emerald-400">{health?.hindsight || 'online'}</span>
                  </div>
                  <div className="flex justify-between items-center text-zinc-300">
                    <span className="text-zinc-500">SQLite + FTS5</span>
                    <span className="font-mono text-emerald-400">{health?.database || 'healthy'}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* 2. Sliding Flyout Drawers (Width: 360px) */}
      {activeFlyout !== 'none' && (
        <aside className="w-80 sm:w-96 h-full bg-[#050505] border-r border-zinc-800/80 flex flex-col z-20 animate-in slide-in-from-left duration-200">
          {/* A. THREADS (SIDE CHATS) FLYOUT */}
          {activeFlyout === 'threads' && (
            <div className="flex flex-col h-full">
              {/* Header */}
              <div className="p-4 border-b border-zinc-800/80 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
                    <GitBranch className="w-4 h-4 text-sky-400" />
                    Side Chats
                  </h3>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Dedicated focus workspaces branched from timeline
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setIsCreatingThread(true)}
                    title="New Side Chat"
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectFlyout('none')}
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Inline Create Thread Input */}
              {isCreatingThread && (
                <div className="p-3 border-b border-zinc-800/80 bg-zinc-900/40 flex flex-col gap-2">
                  <input
                    type="text"
                    placeholder="Side chat topic (e.g. Profiling UV loop)..."
                    value={newThreadTitle}
                    onChange={(e) => setNewThreadTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateNewThread();
                      if (e.key === 'Escape') setIsCreatingThread(false);
                    }}
                    autoFocus
                    className="w-full px-3 py-1.5 text-xs bg-zinc-950 border border-zinc-700 rounded-lg text-zinc-100 outline-none focus:border-zinc-500"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setIsCreatingThread(false)}
                      className="px-2.5 py-1 text-[11px] text-zinc-400 hover:text-zinc-200"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleCreateNewThread}
                      className="px-3 py-1 text-[11px] bg-zinc-100 text-zinc-900 rounded font-medium hover:bg-white"
                    >
                      Create
                    </button>
                  </div>
                </div>
              )}

              {/* Filter Tabs */}
              <div className="px-4 py-2 border-b border-zinc-800/60 flex items-center gap-1 text-xs">
                {(['all', 'active', 'concluded'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setThreadFilter(tab)}
                    className={`px-2.5 py-1 rounded-md capitalize transition-colors ${
                      threadFilter === tab
                        ? 'bg-zinc-800 text-zinc-100 font-medium'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {/* Threads List */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {filteredThreads.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 text-center px-4">
                    <GitBranch className="w-8 h-8 text-zinc-700 mb-2" />
                    <p className="text-xs text-zinc-400">No side chats found</p>
                    <p className="text-[11px] text-zinc-600 mt-1">
                      Side chats keep deep technical investigations organized without cluttering the main timeline.
                    </p>
                  </div>
                ) : (
                  filteredThreads.map((t) => {
                    const isSelected = currentSessionId === t.id;
                    return (
                      <div
                        key={t.id}
                        onClick={() => {
                          onSelectSession(t.id);
                          onSelectFlyout('none');
                        }}
                        className={`group relative p-3 rounded-xl border transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-zinc-900 border-zinc-700 text-zinc-100'
                            : 'bg-zinc-950/60 border-zinc-800/60 hover:bg-zinc-900/60 hover:border-zinc-700/80 text-zinc-300'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <h4 className="text-[13.5px] font-medium truncate flex-1 text-zinc-100">
                            {t.name}
                          </h4>
                          <span
                            className={`text-[10px] font-mono px-1.5 py-0.2 rounded border ${
                              t.status === 'active'
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                            }`}
                          >
                            {t.status}
                          </span>
                        </div>

                        {t.rollup_summary ? (
                          <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed mb-2 font-normal">
                            {t.rollup_summary}
                          </p>
                        ) : (
                          <p className="text-xs text-zinc-600 italic mb-2">
                            Active session in progress...
                          </p>
                        )}

                        <div className="flex items-center justify-between text-[11px] text-zinc-500 pt-1 border-t border-zinc-800/40">
                          <span>{t.message_count || 0} messages</span>
                          <div className="flex items-center gap-2">
                            <span>{formatTimestamp(t.updated_at || t.created_at)}</span>
                            {t.status === 'active' ? (
                              <button
                                type="button"
                                onClick={(e) => handleConcludeThread(t.id, e)}
                                title="Conclude & summarize"
                                className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-emerald-400 transition-opacity"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => handleReopenThread(t.id, e)}
                                title="Reopen side chat"
                                className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-sky-400 transition-opacity"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* B. SEARCH FLYOUT */}
          {activeFlyout === 'search' && (
            <div className="flex flex-col h-full">
              <div className="p-4 border-b border-zinc-800/80 flex items-center justify-between">
                <h3 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
                  <Search className="w-4 h-4 text-zinc-400" />
                  Search
                </h3>
                <button
                  type="button"
                  onClick={() => onSelectFlyout('none')}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-3 border-b border-zinc-800/80 bg-zinc-950">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-2.5 text-zinc-500" />
                  <input
                    type="text"
                    placeholder="Search across all conversations..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    autoFocus
                    className="w-full pl-9 pr-4 py-2 text-xs bg-zinc-900 border border-zinc-700/80 rounded-xl text-zinc-100 outline-none focus:border-zinc-500"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-2.5 text-zinc-500 hover:text-zinc-300"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {isSearching ? (
                  <div className="py-8 text-center text-xs text-zinc-500">Searching...</div>
                ) : searchResults.length === 0 ? (
                  <div className="py-12 text-center text-xs text-zinc-500">
                    {searchQuery.trim() ? 'No matching messages found' : 'Type to search messages and code snippets'}
                  </div>
                ) : (
                  searchResults.map((item, idx) => (
                    <div
                      key={idx}
                      onClick={() => {
                        onSelectSession(item.session_id);
                        onSelectFlyout('none');
                      }}
                      className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/60 hover:bg-zinc-900/60 hover:border-zinc-700 cursor-pointer transition-all"
                    >
                      <div className="flex items-center justify-between text-[11px] text-zinc-500 mb-1.5">
                        <span className="font-medium text-zinc-400 truncate max-w-[200px]">
                          {item.session_name || 'Timeline'}
                        </span>
                        <span>{formatTimestamp(item.created_at)}</span>
                      </div>
                      <p className="text-xs text-zinc-300 line-clamp-3 leading-relaxed font-mono">
                        {item.snippet || item.content}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* C. SHARED LINKS FLYOUT */}
          {activeFlyout === 'links' && (
            <div className="flex flex-col h-full">
              <div className="p-4 border-b border-zinc-800/80 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
                    <Link2 className="w-4 h-4 text-emerald-400" />
                    Shared Links
                  </h3>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Extracted URLs shared across discussions
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectFlyout('none')}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {links.length === 0 ? (
                  <div className="py-12 text-center text-xs text-zinc-500">
                    No links shared yet.
                  </div>
                ) : (
                  links.map((link, idx) => (
                    <a
                      key={idx}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/60 hover:bg-zinc-900/60 hover:border-zinc-700 transition-all group"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-xs font-medium text-zinc-200 truncate group-hover:text-emerald-400 transition-colors">
                          {link.title}
                        </h4>
                        <ExternalLink className="w-3.5 h-3.5 text-zinc-500 shrink-0 mt-0.5" />
                      </div>
                      <p className="text-[11px] text-zinc-500 truncate mt-1 font-mono">
                        {link.url}
                      </p>
                      <div className="flex items-center justify-between text-[10px] text-zinc-600 mt-2">
                        <span>{link.session_name}</span>
                        <span>{formatTimestamp(link.created_at)}</span>
                      </div>
                    </a>
                  ))
                )}
              </div>
            </div>
          )}

          {/* D. CHRONOLOGY FLYOUT */}
          {activeFlyout === 'chronology' && (
            <div className="flex flex-col h-full">
              <div className="p-4 border-b border-zinc-800/80 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-purple-400" />
                    Chronology
                  </h3>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Unified stream of side chats, links, and vault updates
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectFlyout('none')}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {chronology.length === 0 ? (
                  <div className="py-12 text-center text-xs text-zinc-500">
                    No chronological events yet.
                  </div>
                ) : (
                  chronology.map((ev, idx) => (
                    <div
                      key={idx}
                      onClick={() => {
                        if (ev.type === 'thread_event' && ev.metadata?.thread_id) {
                          onSelectSession(ev.metadata.thread_id);
                          onSelectFlyout('none');
                        } else if (ev.type === 'link_event' && ev.metadata?.url) {
                          window.open(ev.metadata.url, '_blank');
                        } else if (ev.type === 'vault_event') {
                          onOpenMemoryInspector();
                        }
                      }}
                      className="relative pl-6 pb-2 border-l border-zinc-800 last:border-l-0 cursor-pointer group"
                    >
                      {/* Timeline dot */}
                      <span
                        className={`absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full ring-4 ring-[#050505] ${
                          ev.type === 'thread_event'
                            ? 'bg-sky-400'
                            : ev.type === 'link_event'
                            ? 'bg-emerald-400'
                            : 'bg-purple-400'
                        }`}
                      />

                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                          {ev.type.replace('_event', '')}
                        </span>
                        <span className="text-[10px] text-zinc-600">
                          {formatTimestamp(ev.timestamp)}
                        </span>
                      </div>

                      <h4 className="text-xs font-semibold text-zinc-200 mt-0.5 group-hover:text-white transition-colors">
                        {ev.title}
                      </h4>

                      {ev.description && (
                        <p className="text-xs text-zinc-400 mt-1 line-clamp-2 leading-relaxed">
                          {ev.description}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </aside>
      )}
    </div>
  );
};
