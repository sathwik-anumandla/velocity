import { useState, useEffect, useRef } from 'react';
import type { FC, MouseEvent } from 'react';
import {
  GitBranch,
  Search,
  Link2,
  Clock,
  X,
  ExternalLink,
  Settings,
} from 'lucide-react';
import type { ActiveFlyout, ThreadItem, NavigationLink, ChronologyEvent } from '../types';
import * as api from '../api';
import type { HealthDetails } from '../api';

interface NavigationRailProps {
  currentSessionId: string | null;
  activeFlyout: ActiveFlyout;
  onSelectFlyout: (flyout: ActiveFlyout) => void;
  onSelectSession: (sessionId: string) => void;
  onOpenMemoryInspector?: () => void;
  onOpenSettings?: () => void;
  theme?: 'dark' | 'light' | 'oled';
  onToggleTheme?: () => void;
  isBackendOnline: boolean;
  healthDetails?: HealthDetails | null;
}

export const NavigationRail: FC<NavigationRailProps> = ({
  currentSessionId,
  activeFlyout,
  onSelectFlyout,
  onSelectSession,
  onOpenMemoryInspector,
  onOpenSettings,
  isBackendOnline,
  healthDetails,
}) => {
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [links, setLinks] = useState<NavigationLink[]>([]);
  const [chronology, setChronology] = useState<ChronologyEvent[]>([]);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  // Status popup state
  const [isStatusOpen, setIsStatusOpen] = useState(false);
  const [fetchedHealth, setFetchedHealth] = useState<HealthDetails | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  const health = fetchedHealth || healthDetails;
  const isHealthy = health ? health.status === 'ok' : isBackendOnline;

  const refreshThreads = async () => {
    try {
      const res = await api.listThreads();
      setThreads(res.threads || []);
    } catch (e) {
      console.error('Failed to load threads:', e);
    }
  };

  const refreshLinks = async () => {
    try {
      const res = await api.getNavigationLinks(60);
      setLinks(res.links || []);
    } catch (e) {
      console.error('Failed to load links:', e);
    }
  };

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
      {/* 1. Vertically Centered Rail (64px) */}
      <nav className="w-16 h-full bg-[#000000] flex flex-col items-center py-5 justify-between">
        {/* Top spacer to vertically balance the rail */}
        <div className="flex-1" />

        {/* 5 Vertically Centered Navigation Action Buttons */}
        <div className="flex flex-col items-center gap-3 w-full px-2">
          {/* Threads (Side Chats) */}
          <button
            type="button"
            onClick={() => onSelectFlyout(activeFlyout === 'threads' ? 'none' : 'threads')}
            title="Side Chats"
            className={`relative w-11 h-11 rounded-2xl flex items-center justify-center transition-colors ${
              activeFlyout === 'threads'
                ? 'bg-[#1e1e22] text-white'
                : 'text-neutral-400 hover:text-white hover:bg-[#141416]'
            }`}
          >
            <GitBranch className="w-5 h-5" />
            {threads.length > 0 && (
              <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-sky-400 ring-2 ring-[#000000]" />
            )}
          </button>

          {/* Search */}
          <button
            type="button"
            onClick={() => onSelectFlyout(activeFlyout === 'search' ? 'none' : 'search')}
            title="Search Messages"
            className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-colors ${
              activeFlyout === 'search'
                ? 'bg-[#1e1e22] text-white'
                : 'text-neutral-400 hover:text-white hover:bg-[#141416]'
            }`}
          >
            <Search className="w-5 h-5" />
          </button>

          {/* Links */}
          <button
            type="button"
            onClick={() => onSelectFlyout(activeFlyout === 'links' ? 'none' : 'links')}
            title="Shared Links"
            className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-colors ${
              activeFlyout === 'links'
                ? 'bg-[#1e1e22] text-white'
                : 'text-neutral-400 hover:text-white hover:bg-[#141416]'
            }`}
          >
            <Link2 className="w-5 h-5" />
          </button>

          {/* Chronology */}
          <button
            type="button"
            onClick={() => onSelectFlyout(activeFlyout === 'chronology' ? 'none' : 'chronology')}
            title="Chronology"
            className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-colors ${
              activeFlyout === 'chronology'
                ? 'bg-[#1e1e22] text-white'
                : 'text-neutral-400 hover:text-white hover:bg-[#141416]'
            }`}
          >
            <Clock className="w-5 h-5" />
          </button>

          {/* Settings */}
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              title="Settings"
              className="w-11 h-11 rounded-2xl flex items-center justify-center text-neutral-400 hover:text-white hover:bg-[#141416] transition-colors"
            >
              <Settings className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Bottom: Health Indicator Dot */}
        <div className="flex-1 flex flex-col justify-end items-center w-full px-2 pb-1">
          <div className="relative" ref={statusRef}>
            <button
              type="button"
              onClick={handleToggleStatus}
              title={`System Status: ${isHealthy ? 'Healthy' : 'Degraded'}`}
              className="w-10 h-10 rounded-2xl flex items-center justify-center hover:bg-[#141416] transition-colors"
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  isHealthy
                    ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]'
                    : 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]'
                }`}
              />
            </button>

            {/* Health Popup Modal */}
            {isStatusOpen && (
              <div className="absolute bottom-2 left-16 ml-3 w-72 bg-[#141416] rounded-2xl p-4 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-150">
                <div className="flex items-center justify-between pb-2.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                    System Health
                  </span>
                  <span
                    className={`text-[11px] font-mono px-2 py-0.5 rounded-full ${
                      isHealthy
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : 'bg-amber-500/10 text-amber-400'
                    }`}
                  >
                    {isHealthy ? 'Operational' : 'Degraded'}
                  </span>
                </div>
                <div className="mt-2 space-y-2 text-xs">
                  <div className="flex justify-between items-center text-neutral-300">
                    <span className="text-neutral-500">FastAPI Backend</span>
                    <span className="font-mono text-emerald-400">{health?.backend || 'connected'}</span>
                  </div>
                  <div className="flex justify-between items-center text-neutral-300">
                    <span className="text-neutral-500">Hindsight Engine</span>
                    <span className="font-mono text-emerald-400">{health?.hindsight || 'online'}</span>
                  </div>
                  <div className="flex justify-between items-center text-neutral-300">
                    <span className="text-neutral-500">SQLite + FTS5</span>
                    <span className="font-mono text-emerald-400">{health?.database || 'healthy'}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* 2. Slide-out Flyout Panel (320px) - Flat, Zero Borders */}
      {activeFlyout !== 'none' && (
        <aside className="w-80 h-full bg-[#0c0c0e] flex flex-col shadow-2xl z-20 animate-in slide-in-from-left-4 duration-200">
          {/* A. THREADS (SIDE CHATS) FLYOUT */}
          {activeFlyout === 'threads' && (
            <div className="flex flex-col h-full">
              <div className="p-4 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-white flex items-center gap-2">
                    <GitBranch className="w-4 h-4 text-sky-400" />
                    Side Chats
                  </h3>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Dedicated focus workspaces branched from timeline
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectFlyout('none')}
                  className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-[#18181b] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Side Chats List */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {threads.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 text-center px-4">
                    <GitBranch className="w-8 h-8 text-neutral-700 mb-2" />
                    <p className="text-xs text-neutral-400">No side chats found</p>
                    <p className="text-[11px] text-neutral-600 mt-1">
                      Type /thread [topic] in chat to branch a topic.
                    </p>
                  </div>
                ) : (
                  threads.map((t) => {
                    const isSelected = currentSessionId === t.id;
                    return (
                      <div
                        key={t.id}
                        onClick={() => {
                          onSelectSession(t.id);
                          onSelectFlyout('none');
                        }}
                        className={`group p-3 rounded-2xl transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-[#1e1e24] text-white shadow-sm'
                            : 'bg-[#141416] hover:bg-[#1c1c20] text-neutral-300'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <h4 className="text-[13.5px] font-medium truncate flex-1 text-white">
                            {t.name}
                          </h4>
                        </div>

                        {t.rollup_summary ? (
                          <p className="text-xs text-neutral-400 line-clamp-2 leading-relaxed mb-2 font-normal">
                            {t.rollup_summary}
                          </p>
                        ) : null}

                        <div className="flex items-center justify-between text-[11px] text-neutral-500 pt-1">
                          <span>{t.message_count || 0} messages</span>
                          <span>{formatTimestamp(t.updated_at || t.created_at)}</span>
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
              <div className="p-4 flex items-center justify-between">
                <h3 className="text-base font-semibold text-white flex items-center gap-2">
                  <Search className="w-4 h-4 text-neutral-400" />
                  Search
                </h3>
                <button
                  type="button"
                  onClick={() => onSelectFlyout('none')}
                  className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-[#18181b] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-3">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-2.5 text-neutral-500" />
                  <input
                    type="text"
                    placeholder="Search messages..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    autoFocus
                    className="w-full pl-9 pr-4 py-2 text-xs bg-[#141416] rounded-xl text-white placeholder-neutral-500 border-none outline-none"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-2.5 text-neutral-500 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {isSearching ? (
                  <div className="py-8 text-center text-xs text-neutral-500">Searching...</div>
                ) : searchResults.length === 0 ? (
                  <div className="py-12 text-center text-xs text-neutral-500">
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
                      className="p-3 rounded-2xl bg-[#141416] hover:bg-[#1c1c20] cursor-pointer transition-all"
                    >
                      <div className="flex items-center justify-between text-[11px] text-neutral-500 mb-1.5">
                        <span className="font-medium text-neutral-300 truncate max-w-[200px]">
                          {item.session_name || 'Timeline'}
                        </span>
                        <span>{formatTimestamp(item.created_at)}</span>
                      </div>
                      <p className="text-xs text-neutral-300 line-clamp-3 leading-relaxed font-mono">
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
              <div className="p-4 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-white flex items-center gap-2">
                    <Link2 className="w-4 h-4 text-emerald-400" />
                    Shared Links
                  </h3>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Extracted URLs shared across discussions
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectFlyout('none')}
                  className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-[#18181b] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {links.length === 0 ? (
                  <div className="py-12 text-center text-xs text-neutral-500">
                    No links shared yet.
                  </div>
                ) : (
                  links.map((link, idx) => (
                    <a
                      key={idx}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block p-3 rounded-2xl bg-[#141416] hover:bg-[#1c1c20] transition-all group"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-xs font-medium text-neutral-200 truncate group-hover:text-emerald-400 transition-colors">
                          {link.title}
                        </h4>
                        <ExternalLink className="w-3.5 h-3.5 text-neutral-500 shrink-0 mt-0.5" />
                      </div>
                      <p className="text-[11px] text-neutral-500 truncate mt-1 font-mono">
                        {link.url}
                      </p>
                      <div className="flex items-center justify-between text-[10px] text-neutral-600 mt-2">
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
              <div className="p-4 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-white flex items-center gap-2">
                    <Clock className="w-4 h-4 text-purple-400" />
                    Chronology
                  </h3>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Unified stream of side chats, links, and vault updates
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectFlyout('none')}
                  className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-[#18181b] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {chronology.length === 0 ? (
                  <div className="py-12 text-center text-xs text-neutral-500">
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
                        } else if (ev.type === 'vault_event' && onOpenMemoryInspector) {
                          onOpenMemoryInspector();
                        }
                      }}
                      className="p-3 rounded-2xl bg-[#141416] hover:bg-[#1c1c20] cursor-pointer transition-all"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-500">
                          {ev.type.replace('_event', '')}
                        </span>
                        <span className="text-[10px] text-neutral-600">
                          {formatTimestamp(ev.timestamp)}
                        </span>
                      </div>

                      <h4 className="text-xs font-semibold text-neutral-200 mt-1">
                        {ev.title}
                      </h4>

                      {ev.description && (
                        <p className="text-xs text-neutral-400 mt-1 line-clamp-2 leading-relaxed">
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
