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
} from 'lucide-react';
import type { Session, SearchResult } from '../types';

interface SidebarProps {
  sessions: Session[];
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, newName: string) => void;
  isTemporary: boolean;
  onToggleTemporary: (val: boolean) => void;
  isBackendOnline: boolean;
  onSearch: (q: string) => Promise<SearchResult[]>;
  onCloseSidebar?: () => void;
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
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close 3-dots popup on click outside
  useEffect(() => {
    if (!menuOpenId) return;
    const handleClickOutside = (e: MouseEvent | any) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpenId]);

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
    const results = await onSearch(val);
    setSearchResults(results);
  };

  return (
    <aside className="w-[280px] flex-shrink-0 h-full bg-[#0A0A0A] border-r border-[#1C1C1E] flex flex-col justify-between select-none">
      {/* 1. Header & New Chat */}
      <div className="p-3.5 flex flex-col gap-2.5">
        {/* Brand Header */}
        <div className="flex items-center justify-between px-1.5 py-1">
          <span className="font-extrabold text-[20px] tracking-tight text-white font-sans">
            Velocity
          </span>
          {onCloseSidebar && (
            <button
              type="button"
              onClick={onCloseSidebar}
              className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-[#141414] transition-colors"
              title="Close sidebar"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* New Chat Button */}
        <button
          type="button"
          onClick={onNewChat}
          className="flex items-center gap-2.5 w-full px-3.5 py-2.5 rounded-xl bg-[#141414] hover:bg-[#1C1C1E] border border-[#222225] text-white text-[13.5px] font-medium transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4 text-zinc-300" />
          <span>New chat</span>
        </button>

        {/* Search Bar */}
        <div className="relative flex items-center w-full px-3 py-2 rounded-xl bg-[#141414] border border-[#222225]">
          <Search className="w-3.5 h-3.5 text-zinc-500 pointer-events-none flex-shrink-0" />
          <input
            type="text"
            placeholder="Search"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full pl-2 pr-6 text-[13px] bg-transparent text-zinc-200 placeholder-zinc-500 outline-none"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => handleSearchChange('')}
              className="text-zinc-500 hover:text-white p-0.5"
            >
              <X className="w-3 h-3" />
            </button>
          ) : (
            <span className="text-[10px] font-mono font-medium text-zinc-500 pointer-events-none">
              ⌘K
            </span>
          )}
        </div>
      </div>

      {/* 2. Conversations Header & Session List */}
      <div className="flex-1 overflow-y-auto px-2.5 flex flex-col">
        {!isSearching && (
          <div className="flex items-center justify-between px-2 py-2 text-xs text-zinc-500 font-medium">
            <span>Conversations</span>
            <span className="font-mono text-[11px]">{sessions.length}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-0.5 py-1">
          {isSearching ? (
            <div>
              <div className="px-2 py-1 text-[11px] font-mono uppercase text-zinc-500">
                Found {searchResults.length} {searchResults.length === 1 ? 'match' : 'matches'}
              </div>
              {searchResults.length === 0 ? (
                <p className="px-2 py-4 text-xs text-zinc-500 text-center">
                  No messages matched "{searchQuery}"
                </p>
              ) : (
                searchResults.map((res) => (
                  <div
                    key={res.id}
                    onClick={() => {
                      onSelectSession(res.session_id);
                      setIsSearching(false);
                      setSearchQuery('');
                    }}
                    className="p-2.5 rounded-xl hover:bg-[#141414] cursor-pointer text-xs group transition-colors"
                  >
                    <p className="font-medium text-zinc-200 truncate">{res.session_name || 'Conversation'}</p>
                    <p className="text-[11px] text-zinc-400 truncate mt-0.5">{res.headline || res.content}</p>
                  </div>
                ))
              )}
            </div>
          ) : (
            sessions.map((session) => {
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
                        className="bg-[#0E0E11] text-white px-2 py-0.5 rounded outline-none border border-zinc-500 text-xs flex-1"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={(e) => handleSaveRename(session.id, e)}
                        className="p-1 text-emerald-400 hover:text-emerald-300"
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

                  {/* Dropdown menu for session options */}
                  {isMenuOpen && (
                    <div
                      ref={menuRef}
                      onClick={(e) => e.stopPropagation()}
                      className="absolute right-2 top-8 z-50 w-32 rounded-xl bg-[#141414] border border-[#27272A] shadow-xl p-1 text-xs text-white animate-fade-in"
                    >
                      <button
                        type="button"
                        onClick={(e) => handleStartRename(session, e)}
                        className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg hover:bg-[#202024] text-zinc-200 hover:text-white transition-colors text-left"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>Rename</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpenId(null);
                          if (confirm(`Delete "${session.name}"?`)) {
                            onDeleteSession(session.id);
                          }
                        }}
                        className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg hover:bg-[#202024] text-rose-400 hover:text-rose-300 transition-colors text-left"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 3. Footer: Hindsight Indicator & Theme Toggle */}
      <div className="p-3 border-t border-[#1C1C1E] flex items-center justify-between bg-[#0A0A0A]">
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

        {/* Theme Icon */}
        <button
          type="button"
          title="Toggle Theme"
          className="p-1 rounded text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <Sun className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
};
