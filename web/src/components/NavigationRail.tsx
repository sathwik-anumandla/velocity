import { useState, useEffect, useRef } from 'react';
import type { FC, MouseEvent } from 'react';
import {
  LineSquiggle,
  Search,
  FileCode2,
  Compass,
  History,
  X,
  ExternalLink,
  SlidersHorizontal,
} from 'lucide-react';
import type { ActiveFlyout, ThreadItem, NavigationLink, ChronologyEvent, Artifact } from '../types';
import * as api from '../api';
import type { HealthDetails } from '../api';

interface NavigationRailProps {
  currentSessionId: string | null;
  activeFlyout: ActiveFlyout;
  onSelectFlyout: (flyout: ActiveFlyout) => void;
  onSelectSession: (sessionId: string) => void;
  onOpenArtifact?: (artifact: Artifact) => void;
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
  onOpenArtifact,
  onOpenMemoryInspector,
  onOpenSettings,
  isBackendOnline,
  healthDetails,
}) => {
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [links, setLinks] = useState<NavigationLink[]>([]);
  const [chronology, setChronology] = useState<ChronologyEvent[]>([]);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [documentQuery, setDocumentQuery] = useState('');
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

  const refreshArtifacts = async () => {
    try {
      const res = await api.listArtifacts();
      setArtifacts(res.artifacts || []);
    } catch (e) {
      console.error('Failed to load artifacts:', e);
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
    refreshArtifacts();
  }, [currentSessionId]);

  useEffect(() => {
    if (activeFlyout === 'threads') {
      refreshThreads();
    } else if (activeFlyout === 'documents') {
      refreshArtifacts();
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
        const h = await api.getHealthDetails();
        setFetchedHealth(h);
      } catch (e) {
        console.error('Failed to fetch detailed health:', e);
      }
    }
  };

  const formatTimestamp = (ts?: string) => {
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

  const filteredArtifacts = documentQuery.trim()
    ? artifacts.filter(
        (a) =>
          a.title.toLowerCase().includes(documentQuery.toLowerCase()) ||
          (a.summary && a.summary.toLowerCase().includes(documentQuery.toLowerCase())) ||
          a.artifact_type.toLowerCase().includes(documentQuery.toLowerCase())
      )
    : artifacts;

  return (
    <div className="flex h-full select-none shrink-0 z-30">
      {/* 1. Vertically Centered Rail (64px) */}
      <nav className="w-16 h-full bg-[var(--bg-card)] flex flex-col items-center py-5 justify-between">
        {/* Top spacer to vertically balance the rail */}
        <div className="flex-1" />

        {/* 6 Vertically Centered Navigation Action Buttons */}
        <div className="flex flex-col items-center gap-2.5 w-full px-2">
          {/* Threads */}
          <button
            type="button"
            onClick={() => onSelectFlyout(activeFlyout === 'threads' ? 'none' : 'threads')}
            title="Threads"
            className={`w-11 h-11 rounded-2xl flex items-center justify-center active:scale-95 transition-all duration-150 ${
              activeFlyout === 'threads'
                ? 'bg-[var(--bg-card-hover)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
            }`}
          >
            <LineSquiggle className="w-5 h-5" />
          </button>

          {/* Search */}
          <button
            type="button"
            onClick={() => onSelectFlyout(activeFlyout === 'search' ? 'none' : 'search')}
            title="Search Messages"
            className={`w-11 h-11 rounded-2xl flex items-center justify-center active:scale-95 transition-all duration-150 ${
              activeFlyout === 'search'
                ? 'bg-[var(--bg-card-hover)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
            }`}
          >
            <Search className="w-5 h-5" />
          </button>

          {/* Documents */}
          <button
            type="button"
            onClick={() => onSelectFlyout(activeFlyout === 'documents' ? 'none' : 'documents')}
            title="Documents"
            className={`w-11 h-11 rounded-2xl flex items-center justify-center active:scale-95 transition-all duration-150 ${
              activeFlyout === 'documents'
                ? 'bg-[var(--bg-card-hover)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
            }`}
          >
            <FileCode2 className="w-5 h-5" />
          </button>

          {/* Links */}
          <button
            type="button"
            onClick={() => onSelectFlyout(activeFlyout === 'links' ? 'none' : 'links')}
            title="Shared Links"
            className={`w-11 h-11 rounded-2xl flex items-center justify-center active:scale-95 transition-all duration-150 ${
              activeFlyout === 'links'
                ? 'bg-[var(--bg-card-hover)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
            }`}
          >
            <Compass className="w-5 h-5" />
          </button>

          {/* Chronology */}
          <button
            type="button"
            onClick={() => onSelectFlyout(activeFlyout === 'chronology' ? 'none' : 'chronology')}
            title="Chronology"
            className={`w-11 h-11 rounded-2xl flex items-center justify-center active:scale-95 transition-all duration-150 ${
              activeFlyout === 'chronology'
                ? 'bg-[var(--bg-card-hover)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
            }`}
          >
            <History className="w-5 h-5" />
          </button>

          {/* Settings */}
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              title="Settings"
              className="w-11 h-11 rounded-2xl flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] active:scale-95 transition-all duration-150"
            >
              <SlidersHorizontal className="w-5 h-5" />
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
              className="w-10 h-10 rounded-2xl flex items-center justify-center hover:bg-[var(--bg-card)] transition-colors"
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  isHealthy
                    ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]'
                    : 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.7)]'
                }`}
              />
            </button>

            {/* Health Flyout Popover */}
            {isStatusOpen && (
              <div className="absolute left-full bottom-0 ml-3 w-80 bg-[var(--bg-card)] rounded-2xl p-4 shadow-2xl z-50 text-[var(--text-primary)] animate-in fade-in duration-150">
                <div className="flex items-center justify-between pb-3 mb-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isHealthy ? 'bg-emerald-500' : 'bg-amber-500'
                      }`}
                    />
                    <h4 className="text-xs font-semibold tracking-tight">System Telemetry</h4>
                  </div>
                  <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase">
                    {isHealthy ? 'Operational' : 'Attention'}
                  </span>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--text-muted)]">Backend Server</span>
                    <span className="text-[var(--text-secondary)] font-mono">
                      {isBackendOnline ? 'Online (8000)' : 'Offline'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--text-muted)]">Database & FTS5</span>
                    <span className="text-[var(--text-secondary)] font-mono">
                      {health?.database || 'Connected'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--text-muted)]">Hindsight Engine</span>
                    <span className="text-[var(--text-secondary)] font-mono">
                      {health?.hindsight || 'Operational'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--text-muted)]">Backend Core</span>
                    <span className="text-[var(--text-secondary)] font-mono">
                      {health?.backend || 'Online (8000)'}
                    </span>
                  </div>
                </div>

                <div className="mt-3 pt-3 flex items-center justify-between text-[10px] text-[var(--text-dim)] font-mono">
                  <span>Velocity Core</span>
                  <span>v2.1</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* 2. Slide-out Flyout Panel (300px) - Minimal, Subtle & Flat */}
      {activeFlyout !== 'none' && (
        <aside className="w-80 h-full bg-[var(--bg-card)] flex flex-col shadow-[20px_0_40px_rgba(0,0,0,0.8)] z-20 animate-in slide-in-from-left-2 duration-150">
          {/* A. THREADS FLYOUT */}
          {activeFlyout === 'threads' && (
            <div className="flex flex-col h-full">
              <div className="px-4 py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <LineSquiggle className="w-4 h-4 text-[var(--accent-violet)]" />
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] tracking-tight">Threads</h3>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectFlyout('none')}
                  className="p-1 rounded-lg text-[var(--text-dim)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Minimal Threads List */}
              <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-1">
                {threads.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 text-center px-4">
                    <LineSquiggle className="w-6 h-6 text-neutral-700 mb-2" />
                    <p className="text-xs text-[var(--text-muted)]">No threads found</p>
                    <p className="text-[11px] text-[var(--text-dim)] mt-1">
                      Type /thread [topic] in chat to branch a focused thread.
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
                        className={`group px-3 py-2.5 rounded-xl transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
                            : 'hover:bg-[var(--bg-card)] text-[var(--text-secondary)]'
                        }`}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <h4 className="text-[13px] font-medium truncate flex-1 text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]">
                            {t.name}
                          </h4>
                          <span className="text-[10px] font-mono text-[var(--text-dim)] shrink-0">
                            {formatTimestamp(t.updated_at || t.created_at)}
                          </span>
                        </div>

                        {t.rollup_summary ? (
                          <p className="text-[11.5px] text-[var(--text-muted)] truncate mt-0.5 font-normal">
                            {t.rollup_summary}
                          </p>
                        ) : (
                          <p className="text-[10.5px] text-[var(--text-dim)] font-mono mt-0.5">
                            {t.message_count || 0} messages
                          </p>
                        )}
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
              <div className="px-4 py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Search className="w-4 h-4 text-[var(--text-muted)]" />
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] tracking-tight">Search</h3>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectFlyout('none')}
                  className="p-1 rounded-lg text-[var(--text-dim)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="px-3 pb-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-[var(--text-dim)]" />
                  <input
                    type="text"
                    placeholder="Search messages..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    autoFocus
                    className="w-full pl-8 pr-7 py-1.5 text-xs bg-[var(--bg-card)] rounded-xl text-[var(--text-primary)] placeholder-neutral-500 border-none outline-none"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-2.5 text-[var(--text-dim)] hover:text-[var(--text-primary)]"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Minimal Search Results List */}
              <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-1">
                {isSearching ? (
                  <div className="py-8 text-center text-xs text-[var(--text-dim)] font-mono">Searching...</div>
                ) : searchResults.length === 0 ? (
                  <div className="py-12 text-center text-xs text-[var(--text-dim)]">
                    {searchQuery.trim() ? 'No matching messages found' : 'Type to search messages and code'}
                  </div>
                ) : (
                  searchResults.map((item, idx) => (
                    <div
                      key={idx}
                      onClick={() => {
                        onSelectSession(item.session_id);
                        onSelectFlyout('none');
                      }}
                      className="px-3 py-2 rounded-xl hover:bg-[var(--bg-card)] cursor-pointer transition-all group"
                    >
                      <div className="flex items-baseline justify-between text-[11px] text-[var(--text-dim)] mb-0.5">
                        <span className="font-medium text-[var(--text-secondary)] truncate max-w-[200px] group-hover:text-[var(--text-primary)]">
                          {item.session_name || 'Timeline'}
                        </span>
                        <span className="font-mono text-[10px]">{formatTimestamp(item.created_at)}</span>
                      </div>
                      <p className="text-xs text-[var(--text-muted)] line-clamp-2 leading-relaxed font-mono">
                        {item.snippet || item.content}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* C. DOCUMENTS FLYOUT */}
          {activeFlyout === 'documents' && (
            <div className="flex flex-col h-full">
              <div className="px-4 py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileCode2 className="w-4 h-4 text-[var(--accent-emerald)]" />
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] tracking-tight">Documents</h3>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectFlyout('none')}
                  className="p-1 rounded-lg text-[var(--text-dim)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="px-3 pb-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-[var(--text-dim)]" />
                  <input
                    type="text"
                    placeholder="Filter documents..."
                    value={documentQuery}
                    onChange={(e) => setDocumentQuery(e.target.value)}
                    className="w-full pl-8 pr-7 py-1.5 text-xs bg-[var(--bg-card)] rounded-xl text-[var(--text-primary)] placeholder-neutral-500 border-none outline-none"
                  />
                  {documentQuery && (
                    <button
                      type="button"
                      onClick={() => setDocumentQuery('')}
                      className="absolute right-2.5 top-2.5 text-[var(--text-dim)] hover:text-[var(--text-primary)]"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Minimal Documents List */}
              <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-1">
                {filteredArtifacts.length === 0 ? (
                  <div className="py-12 text-center text-xs text-[var(--text-dim)]">
                    {documentQuery.trim() ? 'No matching documents' : 'No documents generated yet'}
                  </div>
                ) : (
                  filteredArtifacts.map((doc) => (
                    <button
                      type="button"
                      key={doc.id}
                      onClick={() => {
                        onOpenArtifact?.(doc);
                        onSelectFlyout('none');
                      }}
                      className="w-full text-left px-4 py-4 mb-2 rounded-2xl bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] cursor-pointer transition-all group"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <h4 className="text-sm font-semibold text-[var(--text-primary)] line-clamp-2 flex-1 transition-colors">
                          {doc.title}
                        </h4>
                        <span className="text-[10px] font-mono text-[var(--text-dim)] shrink-0">
                          v{doc.version}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-0.5 text-[10px] text-[var(--text-dim)] font-mono">
                        <span className="uppercase text-[var(--text-muted)]">
                          {doc.artifact_type.replaceAll('_', ' ')}
                        </span>
                        <span>{formatTimestamp(doc.updated_at || doc.created_at)}</span>
                      </div>
                      {doc.summary && (
                        <p className="text-xs leading-relaxed text-[var(--text-muted)] line-clamp-2 mt-2">
                          {doc.summary}
                        </p>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* D. SHARED LINKS FLYOUT */}
          {activeFlyout === 'links' && (
            <div className="flex flex-col h-full">
              <div className="px-4 py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Compass className="w-4 h-4 text-[var(--accent-emerald)]" />
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] tracking-tight">Shared Links</h3>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectFlyout('none')}
                  className="p-1 rounded-lg text-[var(--text-dim)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Minimal Links List */}
              <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-1">
                {links.length === 0 ? (
                  <div className="py-12 text-center text-xs text-[var(--text-dim)]">
                    No links shared yet.
                  </div>
                ) : (
                  links.map((link, idx) => (
                    <a
                      key={idx}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block px-3 py-2.5 rounded-xl hover:bg-[var(--bg-card)] transition-all group"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <h4 className="text-[13px] font-medium text-[var(--text-secondary)] truncate group-hover:text-[var(--accent-emerald)] transition-colors">
                          {link.title}
                        </h4>
                        <ExternalLink className="w-3 h-3 text-[var(--text-dim)] shrink-0" />
                      </div>
                      <p className="text-[11px] text-[var(--text-dim)] truncate mt-0.5 font-mono">
                        {link.url}
                      </p>
                      <div className="flex items-center justify-between text-[10px] text-[var(--text-dim)] mt-1">
                        <span className="truncate max-w-[180px]">{link.session_name}</span>
                        <span>{formatTimestamp(link.created_at)}</span>
                      </div>
                    </a>
                  ))
                )}
              </div>
            </div>
          )}

          {/* E. CHRONOLOGY FLYOUT */}
          {activeFlyout === 'chronology' && (
            <div className="flex flex-col h-full">
              <div className="px-4 py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-purple-400" />
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] tracking-tight">Chronology</h3>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectFlyout('none')}
                  className="p-1 rounded-lg text-[var(--text-dim)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Minimal Chronology List */}
              <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-1">
                {chronology.length === 0 ? (
                  <div className="py-12 text-center text-xs text-[var(--text-dim)]">
                    No chronological events yet.
                  </div>
                ) : (
                  chronology.map((ev, idx) => (
                    <div
                      key={idx}
                      onClick={async () => {
                        if (ev.type === 'thread_event' && ev.metadata?.thread_id) {
                          onSelectSession(ev.metadata.thread_id);
                          onSelectFlyout('none');
                        } else if (ev.type === 'document_event' && ev.metadata?.artifact_id) {
                          try {
                            const doc = await api.getArtifact(ev.metadata.artifact_id);
                            onOpenArtifact?.(doc);
                            onSelectFlyout('none');
                          } catch (e) {
                            console.error('Failed to load artifact from chronology:', e);
                          }
                        } else if (ev.type === 'link_event' && ev.metadata?.url) {
                          window.open(ev.metadata.url, '_blank');
                        } else if (ev.type === 'vault_event' && onOpenMemoryInspector) {
                          onOpenMemoryInspector();
                        }
                      }}
                      className="px-3 py-2.5 rounded-xl hover:bg-[var(--bg-card)] cursor-pointer transition-all group"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-dim)]">
                            {ev.type.replace('_event', '')}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono text-[var(--text-dim)] shrink-0">
                          {formatTimestamp(ev.timestamp)}
                        </span>
                      </div>

                      <h4 className="text-[12.5px] font-medium text-[var(--text-secondary)] mt-0.5 truncate group-hover:text-[var(--text-primary)]">
                        {ev.title}
                      </h4>

                      {ev.description && (
                        <p className="text-[11px] text-[var(--text-muted)] mt-0.5 truncate">
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
