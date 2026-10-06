import { useState, useEffect, useRef } from 'react';
import type { FC, KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  Search,
  X,
  MessageSquare,
  LineSquiggle,
  Sparkles,
  Brain,
  SlidersHorizontal,
  Code2,
  Moon,
  CornerDownLeft,
} from 'lucide-react';
import type { Artifact, SearchResult, ThreadItem } from '../types';
import { RepositorySearch } from './RepositorySearch';

interface CommandOmnibarProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSession: (id: string) => void;
  onSearch: (query: string) => Promise<SearchResult[]>;
  onTriggerRoutine?: (routine: 'briefing' | 'reflection') => void;
  onOpenSettings?: () => void;
  onOpenMemoryInspector?: () => void;
  onToggleCanvas?: () => void;
  onToggleTheme?: () => void;
  threads?: ThreadItem[];
  currentSessionId?: string | null;
  onSelectMessage?: (sessionId: string, messageId: string) => void;
  onOpenArtifact?: (artifact: Artifact) => void;
}

interface ActionItem {
  id: string;
  category: 'Navigation' | 'Routines' | 'System' | 'Search';
  label: string;
  sublabel?: string;
  icon: typeof Search;
  action: () => void;
}

export const CommandOmnibar: FC<CommandOmnibarProps> = ({
  isOpen,
  onClose,
  onSelectSession,
  onSearch,
  onTriggerRoutine,
  onOpenSettings,
  onOpenMemoryInspector,
  onToggleCanvas,
  onToggleTheme,
  threads = [],
  currentSessionId = null,
  onSelectMessage,
  onOpenArtifact,
}) => {
  const [mode, setMode] = useState<'search' | 'commands'>('search');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus on open and reset state
  useEffect(() => {
    if (isOpen) {
      setMode('search');
      setQuery('');
      setSearchResults([]);
      setIsSearching(false);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Debounced search handler for message queries
  useEffect(() => {
    if (!query.trim() || mode === 'search') {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await onSearch(query);
        setSearchResults(results || []);
      } catch (err) {
        console.error('Command omnibar search failed:', err);
      } finally {
        setIsSearching(false);
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [query, onSearch, mode]);

  useEffect(() => {
    if (!isOpen) return;
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  if (mode === 'search') return <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 pt-16 sm:pt-24 backdrop-blur-md" onClick={onClose}>
    <div role="dialog" aria-modal="true" aria-label="Search Velocity" className="flex h-[75vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-[var(--bg-modal)] text-[var(--text-primary)] shadow-2xl" onClick={event => event.stopPropagation()}>
      <div className="flex gap-2 px-4 pt-3"><button aria-pressed="true" className="rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-xs text-[var(--accent)]">Search</button><button onClick={() => setMode('commands')} className="px-3 py-2 text-xs text-[var(--text-muted)]">Commands</button></div>
      <div className="min-h-0 flex-1"><RepositorySearch currentSessionId={currentSessionId} onSelectSession={onSelectSession} onSelectMessage={onSelectMessage || ((sessionId) => onSelectSession(sessionId))} onOpenArtifact={onOpenArtifact} onClose={onClose} /></div>
    </div>
  </div>;

  // Build static commands list
  const baseCommands: ActionItem[] = [
    {
      id: 'nav-main',
      category: 'Navigation',
      label: 'Main Timeline',
      sublabel: 'Lifelong continuous peer-to-peer workspace',
      icon: MessageSquare,
      action: () => {
        onSelectSession('main');
        onClose();
      },
    },
    ...threads.map((t) => ({
      id: `nav-thread-${t.id}`,
      category: 'Navigation' as const,
      label: t.name,
      sublabel: t.rollup_summary || 'Branched Thread',
      icon: LineSquiggle,
      action: () => {
        onSelectSession(t.id);
        onClose();
      },
    })),
    {
      id: 'routine-briefing',
      category: 'Routines',
      label: 'Morning Briefing',
      sublabel: 'Synthesize agenda, overnight updates and priorities',
      icon: Sparkles,
      action: () => {
        onTriggerRoutine?.('briefing');
        onClose();
      },
    },
    {
      id: 'routine-reflection',
      category: 'Routines',
      label: 'Evening Reflection',
      sublabel: 'Review achievements, learnings and unblockers',
      icon: Sparkles,
      action: () => {
        onTriggerRoutine?.('reflection');
        onClose();
      },
    },
    {
      id: 'sys-memory',
      category: 'System',
      label: 'Memory Vault',
      sublabel: 'Inspect long-term memories and knowledge graph',
      icon: Brain,
      action: () => {
        onClose();
        onOpenMemoryInspector?.();
      },
    },
    {
      id: 'sys-settings',
      category: 'System',
      label: 'Settings',
      sublabel: 'Configure models, integrations, schedules and skills',
      icon: SlidersHorizontal,
      action: () => {
        onClose();
        onOpenSettings?.();
      },
    },
    {
      id: 'sys-canvas',
      category: 'System',
      label: 'Toggle Artifact Canvas',
      sublabel: 'Side-by-side engineering artifact viewer',
      icon: Code2,
      action: () => {
        onClose();
        onToggleCanvas?.();
      },
    },
    {
      id: 'sys-theme',
      category: 'System',
      label: 'Toggle Theme',
      sublabel: 'Switch between OLED, Dark, and Light canvases',
      icon: Moon,
      action: () => {
        onClose();
        onToggleTheme?.();
      },
    },
  ];

  // Filter commands by query
  const filteredCommands = query.trim()
    ? baseCommands.filter(
        (cmd) =>
          cmd.label.toLowerCase().includes(query.toLowerCase()) ||
          (cmd.sublabel && cmd.sublabel.toLowerCase().includes(query.toLowerCase()))
      )
    : baseCommands;

  // Total navigable item list (commands + live search results)
  const totalItemCount = filteredCommands.length + searchResults.length;

  const handleKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (totalItemCount > 0) {
        setSelectedIndex((prev) => (prev + 1) % totalItemCount);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (totalItemCount > 0) {
        setSelectedIndex((prev) => (prev - 1 + totalItemCount) % totalItemCount);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex < filteredCommands.length) {
        filteredCommands[selectedIndex].action();
      } else {
        const searchIdx = selectedIndex - filteredCommands.length;
        const result = searchResults[searchIdx];
        if (result) {
          onSelectSession(result.session_id);
          onClose();
        }
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 sm:pt-28 bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150 select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl bg-[var(--bg-card)] shadow-[0_24px_70px_rgba(0,0,0,0.85)] flex flex-col overflow-hidden text-[var(--text-primary)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="flex gap-2 px-4 pt-3"><button onClick={() => setMode('search')} className="px-3 py-2 text-xs text-[var(--text-muted)]">Search</button><button aria-pressed="true" className="rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-xs text-[var(--accent)]">Commands</button></div>
        <div className="flex items-center gap-3 px-4 py-3.5 bg-[var(--bg-card)]">
          <Search className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search messages..."
            className="w-full text-sm font-medium bg-transparent text-[var(--text-primary)] placeholder-neutral-500 outline-none border-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setSearchResults([]);
                setSelectedIndex(0);
                inputRef.current?.focus();
              }}
              className="p-1 rounded-lg text-[var(--text-dim)] hover:text-[var(--text-primary)] transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : (
            <div className="flex items-center gap-1 font-mono text-[10px] text-[var(--text-dim)] bg-[var(--bg-card-hover)] px-1.5 py-0.5 rounded">
              <span>ESC</span>
            </div>
          )}
        </div>

        {/* Action & Result List */}
        <div className="max-h-[380px] overflow-y-auto p-2 space-y-1">
          {filteredCommands.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-dim)] px-3 py-1.5">
                Commands & Navigation
              </div>
              {filteredCommands.map((item, idx) => {
                const isSelected = idx === selectedIndex;
                const IconComponent = item.icon;
                return (
                  <div
                    key={item.id}
                    onClick={item.action}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-[var(--bg-card-hover)] text-[var(--text-primary)] shadow-sm'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card)]'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                          isSelected ? 'bg-[var(--bg-pill)] text-[var(--text-primary)]' : 'bg-[var(--bg-card)] text-[var(--text-muted)]'
                        }`}
                      >
                        <IconComponent className="w-3.5 h-3.5" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold truncate">{item.label}</div>
                        {item.sublabel && (
                          <div className="text-[11px] text-[var(--text-muted)] truncate">{item.sublabel}</div>
                        )}
                      </div>
                    </div>
                    {isSelected && (
                      <CornerDownLeft className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0 ml-2" />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Live Message Search Results */}
          {query.trim() && (
            <div className="pt-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-dim)] px-3 py-1.5 flex items-center justify-between">
                <span>Matching Messages</span>
                {isSearching && <span className="text-[10px] text-[var(--text-muted)] lowercase font-mono">searching...</span>}
              </div>
              {searchResults.length === 0 && !isSearching ? (
                <div className="px-3 py-3 text-xs text-[var(--text-dim)] text-center">
                  No matching messages found
                </div>
              ) : (
                searchResults.map((result, idx) => {
                  const itemIdx = filteredCommands.length + idx;
                  const isSelected = itemIdx === selectedIndex;
                  return (
                    <div
                      key={`search-${idx}`}
                      onClick={() => {
                        onSelectSession(result.session_id);
                        onClose();
                      }}
                      onMouseEnter={() => setSelectedIndex(itemIdx)}
                      className={`flex flex-col gap-1 px-3 py-2.5 rounded-xl cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-[var(--bg-card-hover)] text-[var(--text-primary)] shadow-sm'
                          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card)]'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[11px] text-[var(--text-dim)]">
                        <span className="font-medium text-[var(--text-secondary)] truncate max-w-[240px]">
                          {result.session_name || 'Timeline'}
                        </span>
                        <span className="font-mono text-[10px]">
                          {new Date(result.created_at).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] line-clamp-2 leading-relaxed font-mono">
                        {result.snippet || result.content}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Bottom Keyboard Hint Dock */}
        <div className="px-4 py-2 bg-[var(--bg-card)] flex items-center justify-between text-[10px] text-[var(--text-dim)] font-mono">
          <div className="flex items-center gap-3">
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
          </div>
          <span>ESC to Dismiss</span>
        </div>
      </div>
    </div>
  );
};
