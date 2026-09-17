import { useState, useEffect } from 'react';
import type { FC, FormEvent } from 'react';
import { X, RefreshCw, Brain, Sparkles, Send } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import * as api from '../api';
import type { MentalModelItem, ReflectResponse } from '../api';
import { CodeBlock } from './CognitiveWidgets';

interface MemoryInspectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  isBackendOnline: boolean;
}

const MODEL_TITLES: Record<string, string> = {
  'current-context': 'Current Context',
  'user-persona': 'User Persona',
  'projects-and-decisions': 'Projects & Decisions',
  'goals-and-interests': 'Goals & Interests',
};

const MODEL_DESCRIPTIONS: Record<string, string> = {
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
  const [activeTab, setActiveTab] = useState<'models' | 'reflect'>('models');
  const [activeModelId, setActiveModelId] = useState<string>('current-context');
  const [models, setModels] = useState<MentalModelItem[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  // Reflect query state
  const [reflectQuery, setReflectQuery] = useState('');
  const [isReflecting, setIsReflecting] = useState(false);
  const [reflectResult, setReflectResult] = useState<ReflectResponse | null>(null);

  // Load models on open
  useEffect(() => {
    if (!isOpen) return;

    let mounted = true;
    async function load() {
      setIsLoadingModels(true);
      try {
        const items = await api.getMentalModels();
        if (mounted) setModels(items);
      } catch (err) {
        console.error('Failed to load mental models:', err);
      } finally {
        if (mounted) setIsLoadingModels(false);
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

  const currentModel = models.find((m) => m.id === activeModelId);

  const handleRefreshModels = async () => {
    setIsLoadingModels(true);
    try {
      const items = await api.getMentalModels();
      setModels(items);
    } catch (err) {
      console.error('Failed to refresh models:', err);
    } finally {
      setIsLoadingModels(false);
    }
  };

  const handleRunReflect = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!reflectQuery.trim() || isReflecting) return;
    setIsReflecting(true);
    setReflectResult(null);

    try {
      const res = await api.reflectMemory(reflectQuery.trim());
      setReflectResult(res);
    } catch (err: any) {
      setReflectResult({
        query: reflectQuery,
        answer: `Error executing reflection: ${err.message || err}`,
        citations: [],
        status: 'error',
      });
    } finally {
      setIsReflecting(false);
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
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  isBackendOnline
                    ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50'
                    : 'bg-amber-500 shadow-sm shadow-amber-500/50'
                }`}
              />
              <h2 className="text-base font-semibold tracking-tight">Hindsight Memory Inspector</h2>
            </div>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-[var(--bg-card)] text-[var(--text-dim)]">
              bank: personal-agent
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {activeTab === 'models' && (
              <button
                type="button"
                onClick={handleRefreshModels}
                disabled={isLoadingModels}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors"
                title="Refresh models"
              >
                <RefreshCw className={`w-4 h-4 ${isLoadingModels ? 'animate-spin' : ''}`} />
              </button>
            )}
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

        {/* Sub-nav Tabs (Mental Models vs. Reflect Query) */}
        <div className="flex items-center gap-2 px-6 pt-3 pb-2 flex-shrink-0 select-none bg-[var(--bg-modal)]">
          <button
            type="button"
            onClick={() => setActiveTab('models')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[13px] font-medium transition-colors ${
              activeTab === 'models'
                ? 'bg-[var(--bg-pill)] text-[var(--text-primary)] font-semibold shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
            }`}
          >
            <Brain className="w-3.5 h-3.5" />
            <span>Mental Models</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('reflect')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[13px] font-medium transition-colors ${
              activeTab === 'reflect'
                ? 'bg-[var(--bg-pill)] text-[var(--text-primary)] font-semibold shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Reflect Query</span>
          </button>
        </div>

        {/* Tab 1: Mental Models View */}
        {activeTab === 'models' && (
          <div className="flex-1 flex flex-col min-h-0 px-6 pb-6 overflow-hidden">
            {/* Model Pill Switcher */}
            <div className="flex items-center gap-1.5 py-2 overflow-x-auto select-none flex-shrink-0">
              {['current-context', 'user-persona', 'projects-and-decisions', 'goals-and-interests'].map((id) => {
                const isSelected = id === activeModelId;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveModelId(id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-colors ${
                      isSelected
                        ? 'bg-[var(--bg-card-hover)] text-[var(--text-primary)] font-semibold'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
                    }`}
                  >
                    {MODEL_TITLES[id] || id}
                  </button>
                );
              })}
            </div>

            {/* Model Description Header */}
            <div className="py-2 flex-shrink-0">
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                {MODEL_DESCRIPTIONS[activeModelId]}
              </p>
            </div>

            {/* Model Content Body */}
            <div className="flex-1 overflow-y-auto mt-2 p-4 rounded-xl bg-[var(--bg-modal-inner)] min-h-0">
              {isLoadingModels ? (
                <div className="py-12 text-center select-none">
                  <span className="shimmer-text text-[15px] font-medium">Loading mental models</span>
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
                  <p>No content has been synthesized for this mental model yet.</p>
                  <p className="mt-1">Content will automatically consolidate from your regular chat exchanges.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Reflect Query View */}
        {activeTab === 'reflect' && (
          <div className="flex-1 flex flex-col min-h-0 px-6 pb-6 overflow-hidden">
            <form onSubmit={handleRunReflect} className="flex items-center gap-2 py-2 flex-shrink-0">
              <input
                type="text"
                placeholder="Ask memory anything (e.g. why did we choose React over Flutter?)..."
                value={reflectQuery}
                onChange={(e) => setReflectQuery(e.target.value)}
                className="flex-1 px-4 py-2.5 rounded-xl bg-[var(--bg-modal-inner)] text-[14.5px] font-medium text-[var(--text-primary)] placeholder-[var(--text-dim)] outline-none"
                autoFocus
              />
              <button
                type="submit"
                disabled={!reflectQuery.trim() || isReflecting}
                className={`p-2.5 rounded-xl transition-all ${
                  reflectQuery.trim() && !isReflecting
                    ? 'bg-[var(--text-primary)] text-[var(--bg-primary)] hover:opacity-90'
                    : 'bg-[var(--bg-pill)] text-[var(--text-dim)] cursor-not-allowed'
                }`}
                title="Execute reflection"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>

            {/* Reflection Output */}
            <div className="flex-1 overflow-y-auto mt-2 p-4 rounded-xl bg-[var(--bg-modal-inner)] min-h-0">
              {isReflecting ? (
                <div className="py-12 text-center select-none">
                  <span className="shimmer-text text-[15px] font-medium">Reflecting across past conversations</span>
                </div>
              ) : reflectResult ? (
                <div className="space-y-4">
                  <div className="prose-velocity text-[var(--text-primary)]">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {reflectResult.answer}
                    </ReactMarkdown>
                  </div>

                  {reflectResult.citations && reflectResult.citations.length > 0 && (
                    <div className="mt-4 p-3 rounded-xl bg-[var(--bg-card)]">
                      <h4 className="text-xs font-mono font-semibold uppercase text-[var(--text-dim)] mb-2">
                        Referenced Sources ({reflectResult.citations.length})
                      </h4>
                      <div className="space-y-1.5">
                        {reflectResult.citations.map((c: any, idx: number) => (
                          <div key={idx} className="p-2 rounded-lg bg-[var(--bg-modal)] text-xs text-[var(--text-muted)] font-mono">
                            {typeof c === 'string' ? c : JSON.stringify(c)}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-12 text-center text-xs text-[var(--text-dim)]">
                  <p>Enter a query above to run an agentic reflection across all past conversations and retained insights.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
