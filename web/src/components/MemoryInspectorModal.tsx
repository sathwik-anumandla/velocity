import { useState, useEffect } from 'react';
import type { FC } from 'react';
import { X, RefreshCw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import * as api from '../api';
import type { MentalModelItem } from '../api';
import { CodeBlock } from './CognitiveWidgets';

interface MemoryInspectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  isBackendOnline: boolean;
}

const CATEGORY_TITLES: Record<string, string> = {
  'current-context': 'Current Context',
  'user-persona': 'User Persona',
  'projects-and-decisions': 'Projects & Decisions',
  'goals-and-interests': 'Goals & Interests',
};

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  'current-context': 'Active focus, open loops, recent decisions, and immediate objectives.',
  'user-persona': 'Communication preferences, philosophy, aesthetic taste, and engineering beliefs.',
  'projects-and-decisions': 'Current architecture, tech stack, and key technical decisions with rationale.',
  'goals-and-interests': 'Long-term goals, curiosity topics, and research directions in tech.',
};

export const MemoryInspectorModal: FC<MemoryInspectorModalProps> = ({
  isOpen,
  onClose,
  isBackendOnline,
}) => {
  const [activeCategoryId, setActiveCategoryId] = useState<string>('current-context');
  const [models, setModels] = useState<MentalModelItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Load models on open
  useEffect(() => {
    if (!isOpen) return;

    let mounted = true;
    async function load() {
      setIsLoading(true);
      try {
        const items = await api.getMentalModels();
        if (mounted) setModels(items);
      } catch (err) {
        console.error('Failed to load memory:', err);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    load();

    return () => {
      mounted = false;
    };
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const currentModel = models.find((m) => m.id === activeCategoryId);

  const handleRefresh = async () => {
    setIsLoading(true);
    try {
      const items = await api.getMentalModels();
      setModels(items);
    } catch (err) {
      console.error('Failed to refresh memory:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[88vh] rounded-2xl bg-[var(--bg-modal)] text-[var(--text-primary)] shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header (Flat, no borders) */}
        <div className="flex items-center justify-between px-6 py-4 bg-[var(--bg-sidebar)] flex-shrink-0 select-none">
          <div className="flex items-center gap-2.5">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                isBackendOnline
                  ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50'
                  : 'bg-amber-500 shadow-sm shadow-amber-500/50'
              }`}
            />
            <h2 className="text-base font-semibold tracking-tight">Hindsight Memory</h2>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isLoading}
              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors"
              title="Refresh memory"
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

        {/* Content Body */}
        <div className="flex-1 flex flex-col min-h-0 px-6 pt-4 pb-6 overflow-hidden">
          {/* Direct Category Pills (No intermediate tab switcher, no icons) */}
          <div className="flex items-center gap-1.5 py-1 overflow-x-auto select-none flex-shrink-0">
            {['current-context', 'user-persona', 'projects-and-decisions', 'goals-and-interests'].map((id) => {
              const isSelected = id === activeCategoryId;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveCategoryId(id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-colors ${
                    isSelected
                      ? 'bg-[var(--bg-card-hover)] text-[var(--text-primary)] font-semibold'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
                  }`}
                >
                  {CATEGORY_TITLES[id] || id}
                </button>
              );
            })}
          </div>

          {/* Category Description */}
          <div className="pt-2 pb-1 flex-shrink-0">
            <p className="text-xs text-[var(--text-muted)] leading-relaxed">
              {CATEGORY_DESCRIPTIONS[activeCategoryId]}
            </p>
          </div>

          {/* Synthesized Memory Content Body */}
          <div className="flex-1 overflow-y-auto mt-2 p-4 rounded-xl bg-[var(--bg-modal-inner)] min-h-0">
            {isLoading ? (
              <div className="py-12 text-center select-none">
                <span className="shimmer-text text-[15px] font-medium">Loading memory</span>
              </div>
            ) : currentModel?.content ? (
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
                  {currentModel.content}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="py-12 text-center text-xs text-[var(--text-dim)]">
                <p>No insights consolidated for this section yet.</p>
                <p className="mt-1">Insights will automatically consolidate from your regular chat exchanges.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
