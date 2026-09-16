import { useState } from 'react';
import type { FC, MouseEvent, FormEvent } from 'react';
import { Plus, MessageSquare, Trash2, Edit2, Check, X, Search, EyeOff, ZapOff } from 'lucide-react';
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
}

export const Sidebar: FC<SidebarProps> = ({
  sessions,
  currentSessionId,
  onSelectSession,
  onNewChat,
  onDeleteSession,
  onRenameSession,
  isTemporary,
  onToggleTemporary,
  isBackendOnline,
  onSearch,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const handleStartRename = (session: Session, e: MouseEvent) => {
    e.stopPropagation();
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
    <aside className="w-64 sm:w-72 flex-shrink-0 h-full bg-[#0A0A0C] border-r border-[#1C1C20] flex flex-col justify-between select-none">
      {/* 1. Header & New Chat */}
      <div className="p-3.5 flex flex-col gap-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[15px] tracking-tight text-white font-sans">Velocity</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-zinc-800 text-zinc-300">
              v1.0
            </span>
          </div>
          <div className="flex items-center gap-1.5" title={isBackendOnline ? 'Backend Online' : 'Backend Offline'}>
            {isBackendOnline ? (
              <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" />
            ) : (
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
            )}
          </div>
        </div>

        {/* New Chat Button */}
        <button
          type="button"
          onClick={onNewChat}
          className="flex items-center justify-between w-full px-3 py-2 rounded-xl bg-[#18181C] hover:bg-[#222228] border border-[#27272E] text-white text-xs font-medium transition-all shadow-sm group"
        >
          <span className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-zinc-400 group-hover:text-white transition-colors" />
            <span>New Chat</span>
          </span>
          <span className="text-[10px] font-mono text-zinc-500">⌘K</span>
        </button>

        {/* Full-Text Search input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-zinc-500 pointer-events-none" />
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#121215] border border-[#222226] rounded-xl text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-500"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => handleSearchChange('')}
              className="absolute right-2.5 top-2.5 text-zinc-500 hover:text-white"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* 2. Session List or Search Results */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-1">
        {isSearching ? (
          <div>
            <div className="px-2 py-1 text-[11px] font-mono uppercase text-zinc-500">
              Found {searchResults.length} {searchResults.length === 1 ? 'match' : 'matches'}
            </div>
            {searchResults.length === 0 ? (
              <p className="px-2 py-4 text-xs text-zinc-500 text-center">No messages matched "{searchQuery}"</p>
            ) : (
              searchResults.map((res) => (
                <div
                  key={res.id}
                  onClick={() => {
                    onSelectSession(res.session_id);
                    setIsSearching(false);
                    setSearchQuery('');
                  }}
                  className="p-2.5 rounded-xl hover:bg-[#18181C] cursor-pointer text-xs group transition-colors"
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

            return (
              <div
                key={session.id}
                onClick={() => onSelectSession(session.id)}
                className={`group flex items-center justify-between px-3 py-2 rounded-xl text-xs cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-[#1C1C22] text-white font-medium shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#131317]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <MessageSquare className="w-3.5 h-3.5 flex-shrink-0 text-zinc-500 group-hover:text-zinc-400" />
                  {isItemEditing ? (
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveRename(session.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      className="bg-[#0E0E11] text-white px-1 py-0.5 rounded outline-none border border-zinc-500 text-xs w-full"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="truncate">{session.name || 'Untitled Chat'}</span>
                  )}
                </div>

                {/* Edit & Delete actions */}
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ml-1">
                  {isItemEditing ? (
                    <button
                      type="button"
                      onClick={(e) => handleSaveRename(session.id, e)}
                      className="p-1 text-emerald-400 hover:text-emerald-300"
                    >
                      <Check className="w-3 h-3" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => handleStartRename(session, e)}
                      className="p-1 text-zinc-500 hover:text-white"
                      title="Rename"
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete "${session.name}"?`)) {
                        onDeleteSession(session.id);
                      }
                    }}
                    className="p-1 text-zinc-500 hover:text-rose-400"
                    title="Delete"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 3. Footer with Temporary Session Toggle & Health */}
      <div className="p-3 border-t border-[#1C1C20] flex flex-col gap-2 bg-[#08080A]">
        <button
          type="button"
          onClick={() => onToggleTemporary(!isTemporary)}
          className={`flex items-center justify-between w-full px-2.5 py-1.5 rounded-xl border text-xs transition-colors ${
            isTemporary
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
              : 'bg-transparent border-[#222226] text-zinc-400 hover:text-zinc-200'
          }`}
          title="Temporary sessions bypass Hindsight memory retain and SQLite database persistence"
        >
          <span className="flex items-center gap-1.5">
            <EyeOff className="w-3.5 h-3.5" />
            <span>Incognito Mode</span>
          </span>
          <span className={`text-[10px] font-mono ${isTemporary ? 'text-amber-400 font-bold' : 'text-zinc-600'}`}>
            {isTemporary ? 'ON' : 'OFF'}
          </span>
        </button>

        {!isBackendOnline && (
          <div className="flex items-center gap-2 p-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
            <ZapOff className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
            <span>Backend offline (check localhost:8000)</span>
          </div>
        )}
      </div>
    </aside>
  );
};
