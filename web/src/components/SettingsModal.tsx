import { useState, useEffect } from 'react';
import type { FC } from 'react';
import {
  X,
  Sliders,
  Puzzle,
  Brain,
  Check,
  Calendar,
  CheckSquare,
  Mail,
  ExternalLink,
  Loader2,
  AlertCircle,
  Unplug,
} from 'lucide-react';
import type {
  SupportedModel,
  ThinkingEffort,
  Verbosity,
  RecallBudget,
  IntegrationStatus,
} from '../types';
import * as api from '../api';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'general' | 'plugins' | 'memory';
  initialError?: string | null;
  currentModel: SupportedModel;
  onSelectModel: (model: SupportedModel) => void;
  currentEffort: ThinkingEffort;
  onSelectEffort: (effort: ThinkingEffort) => void;
  currentVerbosity: Verbosity;
  onSelectVerbosity: (verbosity: Verbosity) => void;
  currentRecallBudget: RecallBudget;
  onSelectRecallBudget: (budget: RecallBudget) => void;
  onOpenMemoryInspector: () => void;
}

export const SettingsModal: FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'plugins',
  initialError = null,
  currentModel,
  onSelectModel,
  currentEffort,
  onSelectEffort,
  currentVerbosity,
  onSelectVerbosity,
  currentRecallBudget,
  onSelectRecallBudget,
  onOpenMemoryInspector,
}) => {
  const [activeTab, setActiveTab] = useState<'general' | 'plugins' | 'memory'>(initialTab);
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatus | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(initialError);

  // Sync initialTab when modal opens
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      if (initialError) {
        setAuthError(initialError);
      }
      loadIntegrationStatus();
    }
  }, [isOpen, initialTab, initialError]);

  const loadIntegrationStatus = async () => {
    setIsLoadingStatus(true);
    setAuthError(null);
    try {
      const status = await api.getIntegrationStatus();
      setIntegrationStatus(status);
    } catch (e: any) {
      console.error('Failed to load integration status:', e);
    } finally {
      setIsLoadingStatus(false);
    }
  };

  const handleConnectGoogle = async () => {
    setIsConnecting(true);
    setAuthError(null);
    try {
      const { url } = await api.getGoogleAuthUrl();
      if (url) {
        window.location.href = url;
      }
    } catch (err: any) {
      setAuthError(err.message || 'Failed to initiate Google OAuth flow.');
      setIsConnecting(false);
    }
  };

  const handleDisconnectGoogle = async () => {
    setIsDisconnecting(true);
    setAuthError(null);
    try {
      await api.disconnectGoogle();
      await loadIntegrationStatus();
    } catch (err: any) {
      setAuthError(err.message || 'Failed to disconnect Google account.');
    } finally {
      setIsDisconnecting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl bg-[#09090b] border border-zinc-800 text-zinc-100 shadow-2xl flex flex-col overflow-hidden max-h-[88vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-[#0c0c0e]">
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-semibold text-zinc-100">Settings</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center px-6 border-b border-zinc-800 bg-[#09090b] text-sm">
          <button
            type="button"
            onClick={() => setActiveTab('plugins')}
            className={`flex items-center gap-2 py-3 px-3 font-medium border-b-2 transition-colors ${
              activeTab === 'plugins'
                ? 'border-zinc-100 text-zinc-100'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Puzzle className="w-4 h-4" />
            Plugins & Integrations
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('general')}
            className={`flex items-center gap-2 py-3 px-3 font-medium border-b-2 transition-colors ${
              activeTab === 'general'
                ? 'border-zinc-100 text-zinc-100'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Sliders className="w-4 h-4" />
            General & Model
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('memory')}
            className={`flex items-center gap-2 py-3 px-3 font-medium border-b-2 transition-colors ${
              activeTab === 'memory'
                ? 'border-zinc-100 text-zinc-100'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Brain className="w-4 h-4" />
            Memory Vault
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* TAB 1: PLUGINS */}
          {activeTab === 'plugins' && (
            <div className="space-y-6">
              {authError && (
                <div className="p-3.5 rounded-xl bg-red-950/40 border border-red-900/60 text-xs text-red-300 flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-semibold text-red-200">Google OAuth Error</p>
                    <p>{authError}</p>
                    <p className="text-[11px] text-zinc-400 pt-1">
                      Configure <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> in your <code>.env</code> file or provide <code>data/credentials/credentials.json</code>.
                    </p>
                  </div>
                </div>
              )}

              {/* Google Workspace Plugin Card */}
              <div className="rounded-xl border border-zinc-800 bg-[#0c0c0e] p-5 space-y-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-100">
                      <Puzzle className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2.5">
                        <h3 className="font-semibold text-sm text-zinc-100">Google Workspace</h3>
                        {integrationStatus?.google_connected ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            Connected
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-800 text-zinc-400 border border-zinc-700">
                            <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
                            Not Connected
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        Google Calendar, Google Tasks, and Gmail integration
                      </p>
                    </div>
                  </div>

                  {/* Connect / Disconnect Action */}
                  {integrationStatus?.google_connected ? (
                    <button
                      type="button"
                      disabled={isDisconnecting}
                      onClick={handleDisconnectGoogle}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 text-xs font-medium text-zinc-400 hover:text-red-400 hover:border-red-900/50 hover:bg-red-950/20 transition-colors disabled:opacity-50"
                    >
                      {isDisconnecting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Unplug className="w-3.5 h-3.5" />
                      )}
                      Disconnect
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={isConnecting || isLoadingStatus}
                      onClick={handleConnectGoogle}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-zinc-100 text-zinc-950 text-xs font-semibold hover:bg-white transition-colors shadow disabled:opacity-50"
                    >
                      {isConnecting ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Connecting...
                        </>
                      ) : (
                        <>
                          <ExternalLink className="w-3.5 h-3.5" />
                          Connect Google Account
                        </>
                      )}
                    </button>
                  )}
                </div>

                {/* Account Details if connected */}
                {integrationStatus?.google_connected && (
                  <div className="pt-2 border-t border-zinc-800/60">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs text-zinc-500">Connected account:</span>
                      <span className="text-xs font-mono text-zinc-300 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
                        {integrationStatus.google_user_email || 'Authenticated Account'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <div className="p-3 rounded-lg bg-zinc-900/70 border border-zinc-800/80 space-y-1">
                        <div className="flex items-center gap-2 text-xs font-medium text-zinc-200">
                          <Calendar className="w-3.5 h-3.5 text-zinc-400" />
                          Google Calendar
                        </div>
                        <p className="text-[11px] text-zinc-500">
                          Agenda check and automatic slot scheduling.
                        </p>
                      </div>

                      <div className="p-3 rounded-lg bg-zinc-900/70 border border-zinc-800/80 space-y-1">
                        <div className="flex items-center gap-2 text-xs font-medium text-zinc-200">
                          <CheckSquare className="w-3.5 h-3.5 text-zinc-400" />
                          Google Tasks
                        </div>
                        <p className="text-[11px] text-zinc-500">
                          Direct to-do capture and task completions.
                        </p>
                      </div>

                      <div className="p-3 rounded-lg bg-zinc-900/70 border border-zinc-800/80 space-y-1">
                        <div className="flex items-center gap-2 text-xs font-medium text-zinc-200">
                          <Mail className="w-3.5 h-3.5 text-zinc-400" />
                          Gmail
                        </div>
                        <p className="text-[11px] text-zinc-500">
                          Unread digests, drafts, and send with approval card.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Behavioral Rules Policy Note */}
                <div className="pt-2 text-[11.5px] text-zinc-500 space-y-1 border-t border-zinc-800/40">
                  <p className="font-medium text-zinc-400">Execution Safety Model:</p>
                  <p>
                    - Calendar scheduling and Google Tasks capture execute automatically without turn blockage.
                  </p>
                  <p>
                    - Transmitting emails via Gmail strictly stages an interactive confirmation card before sending.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: GENERAL SETTINGS */}
          {activeTab === 'general' && (
            <div className="space-y-6 text-xs">
              {/* Model Selection */}
              <div className="space-y-2">
                <label className="font-semibold text-zinc-300 block">Default LLM Model</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => onSelectModel('gpt-5.4-mini')}
                    className={`p-3 rounded-xl border text-left transition-colors ${
                      currentModel === 'gpt-5.4-mini'
                        ? 'border-zinc-200 bg-zinc-900/90 text-zinc-100'
                        : 'border-zinc-800 bg-[#0c0c0e] text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm">gpt-5.4-mini</span>
                      {currentModel === 'gpt-5.4-mini' && <Check className="w-4 h-4 text-emerald-400" />}
                    </div>
                    <p className="text-[11px] text-zinc-500 mt-1">Fast, low latency, high throughput</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => onSelectModel('gpt-5.4')}
                    className={`p-3 rounded-xl border text-left transition-colors ${
                      currentModel === 'gpt-5.4'
                        ? 'border-zinc-200 bg-zinc-900/90 text-zinc-100'
                        : 'border-zinc-800 bg-[#0c0c0e] text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm">gpt-5.4</span>
                      {currentModel === 'gpt-5.4' && <Check className="w-4 h-4 text-emerald-400" />}
                    </div>
                    <p className="text-[11px] text-zinc-500 mt-1">Deep reasoning, complex architecture</p>
                  </button>
                </div>
              </div>

              {/* Reasoning Effort */}
              <div className="space-y-2">
                <label className="font-semibold text-zinc-300 block">Reasoning Effort</label>
                <div className="flex flex-wrap gap-2">
                  {(['none', 'low', 'medium', 'high', 'xhigh', 'max'] as ThinkingEffort[]).map((effort) => (
                    <button
                      key={effort}
                      type="button"
                      onClick={() => onSelectEffort(effort)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-medium uppercase tracking-wider transition-colors ${
                        currentEffort === effort
                          ? 'border-zinc-200 bg-zinc-900 text-zinc-100'
                          : 'border-zinc-800 bg-[#0c0c0e] text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {effort}
                    </button>
                  ))}
                </div>
              </div>

              {/* Verbosity */}
              <div className="space-y-2">
                <label className="font-semibold text-zinc-300 block">Response Verbosity</label>
                <div className="flex gap-2">
                  {(['low', 'medium', 'high'] as Verbosity[]).map((verb) => (
                    <button
                      key={verb}
                      type="button"
                      onClick={() => onSelectVerbosity(verb)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-medium capitalize transition-colors ${
                        currentVerbosity === verb
                          ? 'border-zinc-200 bg-zinc-900 text-zinc-100'
                          : 'border-zinc-800 bg-[#0c0c0e] text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {verb}
                    </button>
                  ))}
                </div>
              </div>

              {/* Recall Budget */}
              <div className="space-y-2">
                <label className="font-semibold text-zinc-300 block">Episodic Recall Budget</label>
                <div className="flex gap-2">
                  {(['low', 'medium', 'high'] as RecallBudget[]).map((budget) => (
                    <button
                      key={budget}
                      type="button"
                      onClick={() => onSelectRecallBudget(budget)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-medium capitalize transition-colors ${
                        currentRecallBudget === budget
                          ? 'border-zinc-200 bg-zinc-900 text-zinc-100'
                          : 'border-zinc-800 bg-[#0c0c0e] text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {budget}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: MEMORY VAULT */}
          {activeTab === 'memory' && (
            <div className="space-y-4 text-xs">
              <div className="p-4 rounded-xl border border-zinc-800 bg-[#0c0c0e] space-y-3">
                <h3 className="font-semibold text-sm text-zinc-100">Deterministic Memory Vault</h3>
                <p className="text-zinc-400 leading-relaxed">
                  Velocity maintains an authoritative file-based memory vault located at <code>data/memory/</code>.
                  Core profiles, preferences, active context, and technical dossiers are deterministically loaded into every turn.
                </p>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenMemoryInspector();
                    }}
                    className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-200 hover:bg-zinc-800 hover:text-white transition-colors"
                  >
                    <Brain className="w-4 h-4 text-emerald-400" />
                    Open Full Memory Inspector
                  </button>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-zinc-800 bg-[#0c0c0e] space-y-2">
                <h3 className="font-semibold text-sm text-zinc-100">Episodic Hindsight Memory</h3>
                <p className="text-zinc-400 leading-relaxed">
                  Long-term episodic conversation history is indexed and retained in the Vectorize Hindsight engine backed by PostgreSQL pgvector.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
