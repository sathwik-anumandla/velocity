import { useState, useEffect } from 'react';
import type { FC } from 'react';
import { X, RefreshCw, Edit3, Save, Folder, FileText, Activity } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import * as api from '../api';
import type { VaultTreeItem, ActivityLogEntry } from '../api';
import { CodeBlock } from './CognitiveWidgets';

interface MemoryInspectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  isBackendOnline: boolean;
}

export const MemoryInspectorModal: FC<MemoryInspectorModalProps> = ({
  isOpen,
  onClose,
  isBackendOnline,
}) => {
  const [tree, setTree] = useState<VaultTreeItem[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>('core/profile.md');
  const [docContent, setDocContent] = useState<string>('');
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editBuffer, setEditBuffer] = useState<string>('');
  const [viewMode, setViewMode] = useState<'doc' | 'activity'>('doc');
  const [activityEntries, setActivityEntries] = useState<ActivityLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Load tree and initial doc on open
  useEffect(() => {
    if (!isOpen) return;

    let mounted = true;
    async function loadInitial() {
      setIsLoading(true);
      try {
        const items = await api.getVaultTree();
        if (mounted) {
          setTree(items);
          const defaultPath = items.find((i) => i.path === 'core/profile.md')
            ? 'core/profile.md'
            : items[0]?.path || '';
          if (defaultPath) {
            setSelectedPath(defaultPath);
            const content = await api.getVaultDoc(defaultPath);
            if (mounted) setDocContent(content);
          }
        }
      } catch (err) {
        console.error('Failed to load memory vault:', err);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    loadInitial();

    return () => {
      mounted = false;
    };
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isEditing) {
          setIsEditing(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, isEditing]);

  const handleSelectDoc = async (path: string) => {
    setViewMode('doc');
    setIsEditing(false);
    setSelectedPath(path);
    setIsLoading(true);
    try {
      const content = await api.getVaultDoc(path);
      setDocContent(content);
    } catch (err) {
      console.error('Failed to load doc:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectActivity = async () => {
    setViewMode('activity');
    setIsEditing(false);
    setIsLoading(true);
    try {
      const entries = await api.getVaultActivity(50);
      setActivityEntries(entries);
    } catch (err) {
      console.error('Failed to load activity:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setIsLoading(true);
    try {
      const items = await api.getVaultTree();
      setTree(items);
      if (viewMode === 'doc' && selectedPath) {
        const content = await api.getVaultDoc(selectedPath);
        setDocContent(content);
      } else if (viewMode === 'activity') {
        const entries = await api.getVaultActivity(50);
        setActivityEntries(entries);
      }
    } catch (err) {
      console.error('Failed to refresh:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartEdit = () => {
    setEditBuffer(docContent);
    setIsEditing(true);
  };

  const handleSaveDoc = async () => {
    if (!selectedPath) return;
    setIsSaving(true);
    try {
      const ok = await api.saveVaultDoc(selectedPath, editBuffer);
      if (ok) {
        setDocContent(editBuffer);
        setIsEditing(false);
      }
    } catch (err) {
      console.error('Failed to save document:', err);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  // Group tree items by category
  const categories = Array.from(new Set(tree.map((item) => item.category)));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl h-[86vh] rounded-2xl bg-[var(--bg-modal)] text-[var(--text-primary)] shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-[var(--bg-sidebar)] flex-shrink-0 select-none border-b border-white/[0.04]">
          <div className="flex items-center gap-3">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                isBackendOnline
                  ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50'
                  : 'bg-amber-500 shadow-sm shadow-amber-500/50'
              }`}
            />
            <div>
              <h2 className="text-base font-semibold tracking-tight">Deterministic Memory Vault</h2>
              <p className="text-[11px] text-[var(--text-dim)]">Curated markdown knowledge documents & ground truth</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {viewMode === 'doc' && (
              isEditing ? (
                <>
                  <button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    disabled={isSaving}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveDoc}
                    disabled={isSaving}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-black hover:bg-zinc-200 transition-colors"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{isSaving ? 'Saving...' : 'Save'}</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleStartEdit}
                  disabled={isLoading || !docContent}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors"
                  title="Edit document"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Edit</span>
                </button>
              )
            )}

            <button
              type="button"
              onClick={handleRefresh}
              disabled={isLoading}
              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors"
              title="Close (ESC)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Body: Sidebar + Main Viewer */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left Column: File Tree & Navigation */}
          <div className="w-60 sm:w-64 flex-shrink-0 bg-[var(--bg-sidebar)]/60 flex flex-col justify-between overflow-y-auto p-3 border-r border-white/[0.04]">
            <div className="space-y-4">
              {categories.map((cat) => {
                const catFiles = tree.filter((item) => item.category === cat);
                return (
                  <div key={cat} className="space-y-1">
                    <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-mono font-semibold uppercase tracking-wider text-[var(--text-dim)]">
                      <Folder className="w-3 h-3 text-zinc-500" />
                      <span>{cat}</span>
                    </div>
                    <div className="space-y-0.5">
                      {catFiles.map((f) => {
                        const isSelected = viewMode === 'doc' && selectedPath === f.path;
                        return (
                          <button
                            key={f.path}
                            type="button"
                            onClick={() => handleSelectDoc(f.path)}
                            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-left text-xs transition-colors ${
                              isSelected
                                ? 'bg-[var(--bg-card-hover)] text-[var(--text-primary)] font-semibold'
                                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
                            }`}
                          >
                            <FileText className="w-3.5 h-3.5 flex-shrink-0 text-zinc-400" />
                            <span className="truncate">{f.title || f.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Bottom: Activity Log Tab */}
            <div className="pt-3 mt-3 border-t border-white/[0.04]">
              <button
                type="button"
                onClick={handleSelectActivity}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-left text-xs transition-colors ${
                  viewMode === 'activity'
                    ? 'bg-[var(--bg-card-hover)] text-[var(--text-primary)] font-semibold'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
                }`}
              >
                <Activity className="w-3.5 h-3.5 text-zinc-400" />
                <span>Activity Log</span>
              </button>
            </div>
          </div>

          {/* Right Column: Markdown / Editor / Activity */}
          <div className="flex-1 flex flex-col min-h-0 bg-[var(--bg-modal-inner)] overflow-hidden">
            {isLoading ? (
              <div className="flex-1 flex items-center justify-center select-none">
                <span className="shimmer-text text-[15px] font-medium">Loading</span>
              </div>
            ) : viewMode === 'activity' ? (
              /* Activity Log View */
              <div className="flex-1 overflow-y-auto p-6 space-y-3">
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">Memory Activity Stream</h3>
                  <p className="text-xs text-[var(--text-dim)]">Audit trail of updates, creations, and nightly synthesis cycles</p>
                </div>

                {activityEntries.length === 0 ? (
                  <div className="py-12 text-center text-xs text-[var(--text-dim)]">
                    No activity recorded yet.
                  </div>
                ) : (
                  activityEntries.map((entry, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl bg-[var(--bg-card)] font-mono text-xs space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-white/10 text-white">
                            {entry.source}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-zinc-800 text-zinc-300">
                            {entry.action}
                          </span>
                          <span className="text-[var(--text-primary)] font-semibold">{entry.path}</span>
                        </div>
                        <span className="text-[11px] text-[var(--text-dim)]">
                          {entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : ''}
                        </span>
                      </div>
                      {entry.detail && (
                        <p className="text-[var(--text-secondary)] text-[11px]">{entry.detail}</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            ) : isEditing ? (
              /* Edit View */
              <div className="flex-1 flex flex-col min-h-0 p-4">
                <div className="flex items-center justify-between pb-2 text-xs font-mono text-[var(--text-dim)]">
                  <span>Editing: {selectedPath}</span>
                  <span>Markdown format</span>
                </div>
                <textarea
                  value={editBuffer}
                  onChange={(e) => setEditBuffer(e.target.value)}
                  className="flex-1 w-full p-4 font-mono text-xs leading-relaxed bg-[var(--bg-card)] rounded-xl text-[var(--text-primary)] outline-none resize-none focus:ring-1 focus:ring-zinc-700"
                  spellCheck={false}
                />
              </div>
            ) : (
              /* Document Markdown Reader View */
              <div className="flex-1 flex flex-col min-h-0">
                <div className="px-6 py-3 border-b border-white/[0.04] flex items-center justify-between text-xs font-mono text-[var(--text-dim)] select-none">
                  <span>{selectedPath}</span>
                  <span>Deterministic Memory</span>
                </div>
                <div className="flex-1 overflow-y-auto p-6">
                  {docContent ? (
                    <div className="prose-velocity text-[var(--text-primary)]">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          code({ inline, className, children, ...props }: any) {
                            const match = /language-(\w+)/.exec(className || '');
                            const value = String(children).replace(/\n$/, '');
                            if (!inline && match) {
                              return <CodeBlock language={match[1]} value={value} />;
                            }
                            return (
                              <code
                                className="px-1.5 py-0.5 rounded font-mono text-[13px] font-medium"
                                style={{
                                  color: 'var(--accent-blue)',
                                  backgroundColor: 'var(--accent-blue-bg)',
                                }}
                                {...props}
                              >
                                {children}
                              </code>
                            );
                          },
                        }}
                      >
                        {docContent}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <div className="py-12 text-center text-xs text-[var(--text-dim)]">
                      Empty document.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
