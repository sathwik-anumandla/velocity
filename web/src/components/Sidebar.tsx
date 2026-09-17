import { useState, useRef, useEffect } from 'react';
import type { FC, MouseEvent, FormEvent } from 'react';
import {
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Search,
  MoreVertical,
  PanelLeftClose,
  Sun,
  Moon,
} from 'lucide-react';
import type { Session, SearchResult } from '../types';

interface SidebarProps {
  sessions: Session[];
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, newName: string) => void;
  isBackendOnline: boolean;
  onSearch: (q: string) => Promise<SearchResult[]>;
  onCloseSidebar?: () => void;
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
}

export const Sidebar: FC<SidebarProps> = ({
  sessions,
  currentSessionId,
  onSelectSession,
  onNewChat,
  onDeleteSession,
  onRenameSession,
  isBackendOnline,
  onSearch,
  onCloseSidebar,
  theme = 'dark',
  onToggleTheme,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<Session | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close 3-dots popup on click outside
  useEffect(() => {
    if (!menuOpenId) return;
    const handleClickOutside = (e: any) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpenId]);

  // Global keyboard shortcut: Cmd+K / Ctrl+K opens Search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
      if (e.key === 'Escape' && isSearchOpen) {
        setIsSearchOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSearchOpen]);

  const handleStartRename = (session: Session, e: MouseEvent) => {
    e.stopPropagation();
    setMenuOpenId(null);
    setEditingId(session.id);
    setEditName(session.name);
  };

  const handleSaveRename = (sessionId: string, e?: MouseEvent | FormEvent) => {
    e?.stopPropagation();
    if (editName.trim()) {
      onRenameSession(sessionId, editName.trim());
    }
    setEditingId(null);
  };

  const handleSearchChange = async (val: string) => {
    setSearchQuery(val);
    if (!val.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    try {
      const results = await onSearch(val);
      setSearchResults(results);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <>
      <aside className="w-[280px] flex-shrink-0 h-full bg-[#0A0A0A] flex flex-col justify-between select-none">
        {/* 1. Header & New Chat */}
        <div className="p-3.5 flex flex-col gap-2.5">
          {/* Brand Header: Velocity + Search Button + Collapse Button */}
          <div className="flex items-center justify-between px-1.5 py-1">
            <span className="font-extrabold text-[20px] tracking-tight text-white font-sans">
              Velocity
            </span>
            <div className="flex items-center gap-1">
              {/* Search button directly to the left of the collapse button */}
              <button
                type="button"
                onClick={() => setIsSearchOpen(true)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-[#141414] transition-colors"
                title="Search conversations (⌘K)"
              >
                <Search className="w-4 h-4" />
              </button>

              {onCloseSidebar && (
                <button
                  type="button"
                  onClick={onCloseSidebar}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-[#141414] transition-colors"
                  title="Close sidebar"
                >
                  <PanelLeftClose className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* New Chat Button (Flat, no borders) */}
          <button
            type="button"
            onClick={onNewChat}
            className="flex items-center gap-2.5 w-full px-3.5 py-2.5 rounded-xl bg-[#141414] hover:bg-[#1C1C1E] text-white text-[13.5px] font-medium transition-colors"
          >
            <Plus className="w-4 h-4 text-zinc-300" />
            <span>New chat</span>
          </button>
        </div>

        {/* 2. Conversations Header & Session List */}
        <div className="flex-1 overflow-y-auto px-2.5 flex flex-col">
          <div className="flex items-center justify-between px-2 py-2 text-xs text-zinc-500 font-medium">
            <span>Conversations</span>
            <span className="font-mono text-[11px]">{sessions.length}</span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-0.5 py-1">
            {sessions.map((session) => {
              const isSelected = session.id === currentSessionId;
              const isItemEditing = editingId === session.id;
              const isMenuOpen = menuOpenId === session.id;

              return (
                <div
                  key={session.id}
                  onClick={() => onSelectSession(session.id)}
                  className={`group relative flex items-center justify-between px-3 py-2 rounded-xl text-[13.5px] cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-[#1A1A1A] text-white font-semibold'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#141414] font-medium'
                  }`}
                >
                  {isItemEditing ? (
                    <div className="flex items-center gap-1.5 w-full" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveRename(session.id);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        className="bg-[#0E0E11] text-white px-2 py-0.5 rounded-lg outline-none text-xs flex-1"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={(e) => handleSaveRename(session.id, e)}
                        className="p-1 text-zinc-200 hover:text-white"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="p-1 text-zinc-500 hover:text-zinc-300"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="truncate flex-1 pr-2">{session.name || 'Untitled Chat'}</span>

                      {/* 3-dots menu button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpenId(isMenuOpen ? null : session.id);
                        }}
                        className={`p-1 rounded transition-opacity ${
                          isMenuOpen || isSelected
                            ? 'opacity-100 text-zinc-300'
                            : 'opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-zinc-300'
                        }`}
                        title="Options"
                      >
                        <MoreVertical className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}

                  {/* Dropdown menu for session options (Flat, no borders) */}
                  {isMenuOpen && (
                    <div
                      ref={menuRef}
                      onClick={(e) => e.stopPropagation()}
                      className="absolute right-2 top-8 z-50 w-32 rounded-xl bg-[#1C1C20] shadow-2xl p-1 text-xs text-white animate-fade-in"
                    >
                      <button
                        type="button"
                        onClick={(e) => handleStartRename(session, e)}
                        className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg hover:bg-[#28282E] text-zinc-200 hover:text-white transition-colors text-left"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>Rename</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpenId(null);
                          setSessionToDelete(session);
                        }}
                        className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg hover:bg-[#28282E] text-zinc-300 hover:text-white transition-colors text-left"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 3. Footer: Hindsight Indicator (Only permitted color) & Theme Toggle */}
        <div className="p-3.5 flex items-center justify-between bg-[#0A0A0A]">
          {/* Glowing Hindsight Pulse Dot + Text */}
          <div className="flex items-center gap-2 px-1">
            <span
              className={`w-2 h-2 rounded-full ${
                isBackendOnline
                  ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50'
                  : 'bg-amber-500 shadow-sm shadow-amber-500/50'
              }`}
            />
            <span className="text-[12px] font-mono font-medium text-zinc-400">
              {isBackendOnline ? 'Hindsight: Ready' : 'Hindsight: Degraded'}
            </span>
          </div>

          {/* Theme Toggle Button */}
          {onToggleTheme && (
            <button
              type="button"
              onClick={onToggleTheme}
              title={theme === 'dark' ? 'Switch to Light theme' : 'Switch to Dark theme'}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-[#141414] transition-colors"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          )}
        </div>
      </aside>

      {/* In-UI Search Modal (NO borders, flat design) */}
      {isSearchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/75 backdrop-blur-sm p-4 animate-fade-in"
          onClick={() => setIsSearchOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-2xl bg-[#141414] p-4 text-white shadow-2xl flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-[#0A0A0A]">
              <Search className="w-4 h-4 text-zinc-400 flex-shrink-0" />
              <input
                type="text"
                placeholder="Search conversations & messages..."
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="w-full text-sm bg-transparent text-white placeholder-zinc-500 outline-none"
                autoFocus
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => handleSearchChange('')}
                  className="text-zinc-500 hover:text-white p-0.5"
                >
                  <X className="w-4 h-4" />
                </button>
              ) : (
                <span className="text-[10px] font-mono text-zinc-500">ESC</span>
              )}
            </div>

            {/* Results */}
            <div className="max-h-80 overflow-y-auto space-y-1">
              {isSearching ? (
                <p className="text-xs text-zinc-500 py-6 text-center font-mono">Searching...</p>
              ) : searchResults.length > 0 ? (
                searchResults.map((res) => (
                  <div
                    key={res.message_id}
                    onClick={() => {
                      onSelectSession(res.session_id);
                      setIsSearchOpen(false);
                      setSearchQuery('');
                      setSearchResults([]);
                    }}
                    className="p-3 rounded-xl hover:bg-[#1C1C20] cursor-pointer transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-white truncate">{res.session_name || 'Conversation'}</p>
                      <span className="text-[10px] font-mono text-zinc-500 uppercase">{res.role}</span>
                    </div>
                    <p
                      className="text-xs text-zinc-400 mt-1 line-clamp-2"
                      dangerouslySetInnerHTML={{ __html: res.snippet || res.content }}
                    />
                  </div>
                ))
              ) : searchQuery.trim() ? (
                <p className="text-xs text-zinc-500 py-6 text-center">No results found for "{searchQuery}"</p>
              ) : (
                <p className="text-xs text-zinc-500 py-6 text-center">Type to search through all past conversations...</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* In-UI Delete Confirmation Dialog (NO browser alerts!) */}
      {sessionToDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fade-in"
          onClick={() => setSessionToDelete(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-[#141414] p-5 text-white shadow-2xl flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="text-base font-semibold">Delete conversation?</h3>
              <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
                "{sessionToDelete.name}" will be permanently removed. This action cannot be undone.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 text-xs font-medium pt-1">
              <button
                type="button"
                onClick={() => setSessionToDelete(null)}
                className="px-3.5 py-2 rounded-xl text-zinc-400 hover:text-white hover:bg-[#202024] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteSession(sessionToDelete.id);
                  setSessionToDelete(null);
                }}
                className="px-4 py-2 rounded-xl bg-white text-black hover:bg-zinc-200 transition-colors font-semibold"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
