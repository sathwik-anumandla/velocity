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
import type { Session } from '../types';

interface SidebarProps {
  sessions: Session[];
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, newName: string) => void;
  isBackendOnline: boolean;
  onOpenSearch: () => void;
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
  onOpenSearch,
  onCloseSidebar,
  theme = 'dark',
  onToggleTheme,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [sessionToDelete, setSessionToDelete] = useState<Session | null>(null);
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

  return (
    <>
      <aside className="w-[280px] flex-shrink-0 h-full bg-[var(--bg-sidebar)] flex flex-col justify-between select-none">
        {/* 1. Header & New Chat */}
        <div className="p-3.5 flex flex-col gap-2.5">
          {/* Brand Header: Velocity (bold) + Search Button + Collapse Button */}
          <div className="flex items-center justify-between px-1.5 py-1">
            <span className="font-black text-[21px] tracking-tight text-[var(--text-primary)] font-sans">
              Velocity
            </span>
            <div className="flex items-center gap-1">
              {/* Search button directly to the left of the collapse button */}
              <button
                type="button"
                onClick={onOpenSearch}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors"
                title="Search conversations (⌘K)"
              >
                <Search className="w-4 h-4" />
              </button>

              {onCloseSidebar && (
                <button
                  type="button"
                  onClick={onCloseSidebar}
                  className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors"
                  title="Close sidebar (⌘B)"
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
            className="flex items-center gap-2.5 w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] text-[var(--text-primary)] text-[13.5px] font-medium transition-colors"
          >
            <Plus className="w-4 h-4 text-[var(--text-muted)]" />
            <span>New chat</span>
          </button>
        </div>

        {/* 2. Conversations Header & Session List */}
        <div className="flex-1 overflow-y-auto px-2.5 flex flex-col">
          <div className="flex items-center justify-between px-2 py-2 text-xs text-[var(--text-dim)] font-medium">
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
                      ? 'bg-[var(--bg-card-hover)] text-[var(--text-primary)] font-semibold'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] font-medium'
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
                        className="bg-[var(--bg-modal-inner)] text-[var(--text-primary)] px-2 py-0.5 rounded-lg outline-none text-xs flex-1 font-medium"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={(e) => handleSaveRename(session.id, e)}
                        className="p-1 text-[var(--text-primary)] hover:opacity-80"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="p-1 text-[var(--text-dim)] hover:text-[var(--text-primary)]"
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
                            ? 'opacity-100 text-[var(--text-primary)]'
                            : 'opacity-0 group-hover:opacity-100 text-[var(--text-dim)] hover:text-[var(--text-primary)]'
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
                      className="absolute right-2 top-8 z-50 w-32 rounded-xl bg-[var(--bg-popover)] shadow-2xl p-1 text-xs text-[var(--text-primary)] animate-fade-in"
                    >
                      <button
                        type="button"
                        onClick={(e) => handleStartRename(session, e)}
                        className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg hover:bg-[var(--bg-popover-item-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors text-left font-medium"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>Rename</span>
                      </button>
                      {/* Red delete button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpenId(null);
                          setSessionToDelete(session);
                        }}
                        className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg hover:bg-red-500/10 text-red-500 hover:text-red-400 transition-colors text-left font-medium"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-500" />
                        <span>Delete</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 3. Footer: Hindsight Indicator & Theme Toggle */}
        <div className="p-3.5 flex items-center justify-between bg-[var(--bg-sidebar)]">
          {/* Glowing Hindsight Pulse Dot + Text */}
          <div className="flex items-center gap-2 px-1">
            <span
              className={`w-2 h-2 rounded-full ${
                isBackendOnline
                  ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50'
                  : 'bg-amber-500 shadow-sm shadow-amber-500/50'
              }`}
            />
            <span className="text-[12px] font-mono font-medium text-[var(--text-muted)]">
              {isBackendOnline ? 'Hindsight: Ready' : 'Hindsight: Degraded'}
            </span>
          </div>

          {/* Theme Toggle Button */}
          {onToggleTheme && (
            <button
              type="button"
              onClick={onToggleTheme}
              title={theme === 'dark' ? 'Switch to Light theme' : 'Switch to Dark theme'}
              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          )}
        </div>
      </aside>

      {/* In-UI Delete Confirmation Dialog (NO browser alerts!) */}
      {sessionToDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in"
          onClick={() => setSessionToDelete(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-[var(--bg-modal)] p-5 text-[var(--text-primary)] shadow-2xl flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="text-base font-semibold">Delete conversation?</h3>
              <p className="text-xs text-[var(--text-muted)] mt-1.5 leading-relaxed font-medium">
                "{sessionToDelete.name}" will be permanently removed. This action cannot be undone.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 text-xs font-medium pt-1">
              <button
                type="button"
                onClick={() => setSessionToDelete(null)}
                className="px-3.5 py-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors"
              >
                Cancel
              </button>
              {/* Red delete button */}
              <button
                type="button"
                onClick={() => {
                  onDeleteSession(sessionToDelete.id);
                  setSessionToDelete(null);
                }}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white transition-colors font-medium text-xs shadow-sm shadow-red-950/30"
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
