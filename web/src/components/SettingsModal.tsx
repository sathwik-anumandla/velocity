import { useState, useEffect } from 'react';
import { UsageTab } from './UsageTab';
import { DeploymentInfo } from './DeploymentInfo';
import type { FC } from 'react';
import {
  X,
  Sliders,
  Puzzle,
  Brain,
  Check,
  ExternalLink,
  AlertCircle,
  Unplug,
  Clock,
  Sparkles,
  Plus,
  Trash2,
  Pause,
  Play,
  Edit3,
  Search,
  Save,
  FileText,
  Sun,
  Moon,
  Monitor,
  ChartColumn,
  Cpu,
  MessageSquare,
  History,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  SupportedModel,
  ThinkingEffort,
  Verbosity,
  RecallBudget,
  IntegrationStatus,
  ScheduledEvent,
  Skill,
} from '../types';
import * as api from '../api';
import type { VaultTreeItem } from '../api';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'general' | 'plugins' | 'memory' | 'schedules' | 'skills' | 'usage';
  initialError?: string | null;
  currentModel: SupportedModel;
  onSelectModel: (model: SupportedModel) => void;
  currentEffort: ThinkingEffort;
  onSelectEffort: (effort: ThinkingEffort) => void;
  currentVerbosity: Verbosity;
  onSelectVerbosity: (verbosity: Verbosity) => void;
  currentRecallBudget: RecallBudget;
  onSelectRecallBudget: (budget: RecallBudget) => void;
  onOpenMemoryInspector?: () => void;
  theme?: 'dark' | 'light' | 'oled';
  onSelectTheme?: (theme: 'dark' | 'light' | 'oled') => void;
}

export const SettingsModal: FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'general',
  initialError = null,
  currentModel,
  onSelectModel,
  currentEffort,
  onSelectEffort,
  currentVerbosity,
  onSelectVerbosity,
  currentRecallBudget,
  onSelectRecallBudget,
  theme = 'dark',
  onSelectTheme,
}) => {
  const [activeTab, setActiveTab] = useState<'general' | 'plugins' | 'memory' | 'schedules' | 'skills' | 'usage'>(initialTab);
  const [searchFilter, setSearchFilter] = useState('');

  // Plugins state
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatus | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(initialError);

  // Schedules state
  const [schedules, setSchedules] = useState<ScheduledEvent[]>([]);
  const [isCreatingSchedule, setIsCreatingSchedule] = useState(false);
  const [newScheduleName, setNewScheduleName] = useState('');
  const [newScheduleType, setNewScheduleType] = useState<'recurring' | 'one_shot'>('recurring');
  const [newScheduleFrequency, setNewScheduleFrequency] = useState<'daily' | 'weekdays' | 'weekends'>('daily');
  const [newScheduleTime, setNewScheduleTime] = useState('08:00');
  const [newScheduleDateTime, setNewScheduleDateTime] = useState('');
  const [newSchedulePrompt, setNewSchedulePrompt] = useState('');
  const [newScheduleSkillId, setNewScheduleSkillId] = useState('');
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [isSubmittingSchedule, setIsSubmittingSchedule] = useState(false);

  // Skills state
  const [skills, setSkills] = useState<Skill[]>([]);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [skillInstructionsDraft, setSkillInstructionsDraft] = useState('');
  const [isSavingSkill, setIsSavingSkill] = useState(false);

  // Memory Vault state
  const [vaultTree, setVaultTree] = useState<VaultTreeItem[]>([]);
  const [selectedVaultPath, setSelectedVaultPath] = useState<string>('core/profile.md');
  const [vaultDocContent, setVaultDocContent] = useState<string>('');
  const [isEditingVaultDoc, setIsEditingVaultDoc] = useState(false);
  const [vaultDocEditDraft, setVaultDocEditDraft] = useState('');
  const [isLoadingVault, setIsLoadingVault] = useState(false);
  const [isSavingVault, setIsSavingVault] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      if (initialError) setAuthError(initialError);
      if (initialTab === 'plugins') loadIntegrationStatus();
      if (initialTab === 'schedules') loadSchedules();
      if (initialTab === 'skills') loadSkills();
      if (initialTab === 'memory') loadVault();
    }
  }, [isOpen, initialTab, initialError]);

  useEffect(() => {
    if (!isOpen) return;
    if (activeTab === 'plugins') loadIntegrationStatus();
    if (activeTab === 'schedules') loadSchedules();
    if (activeTab === 'skills') loadSkills();
    if (activeTab === 'memory') loadVault();
  }, [activeTab, isOpen]);

  const loadIntegrationStatus = async () => {
    setAuthError(null);
    try {
      const status = await api.getIntegrationStatus();
      setIntegrationStatus(status);
    } catch (e: any) {
      console.error('Failed to load integration status:', e);
    }
  };

  const handleConnectGoogle = async () => {
    setIsConnecting(true);
    setAuthError(null);
    try {
      const { url } = await api.getGoogleAuthUrl();
      window.location.href = url;
    } catch (e: any) {
      setAuthError(e.message || 'Failed to initiate Google authorization');
      setIsConnecting(false);
    }
  };

  const handleDisconnectGoogle = async () => {
    setIsDisconnecting(true);
    setAuthError(null);
    try {
      await api.disconnectGoogle();
      await loadIntegrationStatus();
    } catch (e: any) {
      setAuthError(e.message || 'Failed to disconnect Google account');
    } finally {
      setIsDisconnecting(false);
    }
  };

  const loadSchedules = async () => {
    try {
      const list = await api.listSchedules();
      setSchedules(list);
    } catch (e) {
      console.error('Failed to load schedules:', e);
    }
  };

  const handleToggleSchedule = async (sched: ScheduledEvent) => {
    try {
      const nextStatus = sched.status === 'active' ? 'paused' : 'active';
      await api.updateSchedule(sched.id, { status: nextStatus });
      await loadSchedules();
    } catch (err) {
      console.error('Failed to toggle schedule:', err);
    }
  };

  const handleDeleteSchedule = async (scheduleId: string) => {
    try {
      await api.deleteSchedule(scheduleId);
      await loadSchedules();
    } catch (err) {
      console.error('Failed to delete schedule:', err);
    }
  };

  const handleCreateSchedule = async () => {
    if (!newScheduleName.trim()) {
      setScheduleError('Please provide a name for this routine.');
      return;
    }
    if (!newSchedulePrompt.trim() && !newScheduleSkillId) {
      setScheduleError('Please provide prompt instructions or select a skill.');
      return;
    }

    let cronExpr: string | undefined = undefined;
    if (newScheduleType === 'recurring') {
      const [h, m] = newScheduleTime.split(':').map((s) => s.trim());
      if (newScheduleFrequency === 'weekdays') {
        cronExpr = `${m} ${h} * * 1-5`;
      } else if (newScheduleFrequency === 'weekends') {
        cronExpr = `${m} ${h} * * 6,0`;
      } else {
        cronExpr = `${m} ${h} * * *`;
      }
    }

    let runAtIso: string | undefined = undefined;
    if (newScheduleType === 'one_shot') {
      if (!newScheduleDateTime) {
        setScheduleError('Please select a date and time for the reminder.');
        return;
      }
      try {
        runAtIso = new Date(newScheduleDateTime).toISOString();
      } catch {
        setScheduleError('Invalid date/time selected.');
        return;
      }
    }

    setScheduleError(null);
    setIsSubmittingSchedule(true);
    try {
      await api.createSchedule({
        name: newScheduleName.trim(),
        event_type: newScheduleType,
        prompt: newSchedulePrompt.trim(),
        cron_expression: cronExpr,
        run_at: runAtIso,
        skill_id: newScheduleSkillId.trim() || undefined,
        session_id: 'main',
      });
      setIsCreatingSchedule(false);
      setNewScheduleName('');
      setNewSchedulePrompt('');
      setNewScheduleTime('08:00');
      setNewScheduleFrequency('daily');
      setNewScheduleDateTime('');
      setNewScheduleSkillId('');
      await loadSchedules();
    } catch (err: any) {
      setScheduleError(err.message || 'Failed to create schedule');
    } finally {
      setIsSubmittingSchedule(false);
    }
  };

  const loadSkills = async () => {
    try {
      const list = await api.listSkills();
      setSkills(list);
    } catch (e) {
      console.error('Failed to load skills:', e);
    }
  };

  const handleToggleSkill = async (skill: Skill) => {
    try {
      await api.updateSkill(skill.id, { enabled: !skill.enabled });
      await loadSkills();
    } catch (err) {
      console.error('Failed to toggle skill:', err);
    }
  };

  const handleOpenEditSkill = (skill: Skill) => {
    setEditingSkill(skill);
    setSkillInstructionsDraft(skill.instructions || '');
  };

  const handleSaveSkillInstructions = async () => {
    if (!editingSkill) return;
    setIsSavingSkill(true);
    try {
      await api.updateSkill(editingSkill.id, { instructions: skillInstructionsDraft });
      setEditingSkill(null);
      await loadSkills();
    } catch (err) {
      console.error('Failed to save skill instructions:', err);
    } finally {
      setIsSavingSkill(false);
    }
  };

  const loadVault = async () => {
    setIsLoadingVault(true);
    try {
      const tree = await api.getVaultTree();
      setVaultTree(tree);
      const defaultPath = tree.find((t) => t.path === 'core/profile.md') ? 'core/profile.md' : tree[0]?.path;
      if (defaultPath) {
        setSelectedVaultPath(defaultPath);
        const doc = await api.getVaultDoc(defaultPath);
        setVaultDocContent(doc);
      }
    } catch (e) {
      console.error('Failed to load memory vault:', e);
    } finally {
      setIsLoadingVault(false);
    }
  };

  const handleSelectVaultDoc = async (path: string) => {
    setSelectedVaultPath(path);
    setIsEditingVaultDoc(false);
    setIsLoadingVault(true);
    try {
      const content = await api.getVaultDoc(path);
      setVaultDocContent(content);
    } catch (e) {
      console.error('Failed to load doc:', e);
    } finally {
      setIsLoadingVault(false);
    }
  };

  const handleSaveVaultDoc = async () => {
    if (!selectedVaultPath) return;
    setIsSavingVault(true);
    try {
      await api.saveVaultDoc(selectedVaultPath, vaultDocEditDraft);
      setVaultDocContent(vaultDocEditDraft);
      setIsEditingVaultDoc(false);
    } catch (e) {
      console.error('Failed to save doc:', e);
    } finally {
      setIsSavingVault(false);
    }
  };

  if (!isOpen) return null;

  const navCategories = [
    {
      group: 'Settings',
      items: [
        { id: 'general', label: 'General', icon: Sliders },
        { id: 'usage', label: 'Usage', icon: ChartColumn },
        { id: 'memory', label: 'Memory', icon: Brain },
      ],
    },
    {
      group: 'Capabilities',
      items: [
        { id: 'plugins', label: 'Plugins', icon: Puzzle },
        { id: 'schedules', label: 'Schedules', icon: Clock },
      ],
    },
    {
      group: 'Customize',
      items: [
        { id: 'skills', label: 'Skills', icon: Sparkles },
      ],
    },
  ];

  const filteredCategories = navCategories
    .map((cat) => ({
      ...cat,
      items: cat.items.filter((item) =>
        item.label.toLowerCase().includes(searchFilter.toLowerCase())
      ),
    }))
    .filter((cat) => cat.items.length > 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl h-[660px] max-h-[90vh] rounded-2xl bg-[var(--bg-card)] text-[var(--text-primary)] shadow-2xl flex overflow-hidden select-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left Navigation Pane (Matching settings-layout.png) */}
        <aside className="w-16 sm:w-56 bg-[var(--bg-code)] p-2 sm:p-4 flex flex-col shrink-0">
          {/* Top Search Input */}
          <div className="relative mb-3 hidden sm:block">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-[var(--text-dim)]" />
            <input
              type="text"
              placeholder="Search..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-[var(--bg-card)] rounded-xl text-xs text-[var(--text-primary)] placeholder-neutral-500 border-none outline-none"
            />
          </div>

          {/* Navigation Categories */}
          <div className="flex-1 overflow-y-auto space-y-4 pt-1">
            {filteredCategories.map((cat) => (
              <div key={cat.group}>
                <div className="hidden sm:block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-dim)] px-3 mb-1">
                  {cat.group}
                </div>
                <div className="space-y-0.5">
                  {cat.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeTab === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        aria-label={item.label}
                        aria-current={isActive ? 'page' : undefined}
                        onClick={() => setActiveTab(item.id as any)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors text-left ${
                          isActive
                            ? 'bg-[var(--bg-card-hover)] text-[var(--text-primary)] shadow-sm'
                            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
                        }`}
                      >
                        <Icon className={`w-4 h-4 ${isActive ? 'text-[var(--text-primary)]' : 'text-[var(--text-dim)]'}`} />
                        <span className="hidden sm:inline">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Right Content Area */}
        <main className="flex-1 min-w-0 bg-[var(--bg-card)] p-4 sm:p-6 overflow-y-auto flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between pb-5 mb-5 shrink-0">
            <div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)] capitalize">
                {activeTab === 'general'
                  ? 'General'
                  : activeTab === 'usage'
                  ? 'Usage'
                  : activeTab === 'memory'
                  ? 'Memory'
                  : activeTab === 'plugins'
                  ? 'Plugins'
                  : activeTab === 'schedules'
                  ? 'Schedules'
                  : 'Skills'}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close settings"
              className="p-1.5 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body Content */}
          <div className="flex-1 overflow-y-auto space-y-6 pr-1">
            {activeTab === 'usage' && <UsageTab />}
            {/* 1. GENERAL TAB */}
            {activeTab === 'general' && (
              <div className="space-y-6 text-xs">
                <DeploymentInfo />
                {/* Theme Selector */}
                <div className="p-4 rounded-2xl bg-[var(--bg-code)] space-y-3">
                  <div>
                    <div className="flex items-center gap-2 font-semibold text-[var(--text-primary)] text-sm"><Sun size={16} aria-hidden="true" />Appearance</div>
                    <p className="text-[var(--text-muted)] mt-0.5">Select visual theme preference.</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    {(['dark', 'light', 'oled'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => onSelectTheme?.(t)}
                        className={`p-3 rounded-xl flex items-center justify-center gap-2 transition-all font-medium capitalize ${
                          theme === t
                            ? 'bg-[var(--bg-card-hover)] text-[var(--text-primary)] shadow-sm ring-1 ring-[var(--bg-pill-hover)]'
                            : 'bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        {t === 'light' ? (
                          <Sun className="w-4 h-4 text-[var(--accent-amber)]" />
                        ) : t === 'oled' ? (
                          <Monitor className="w-4 h-4 text-[var(--accent-blue)]" />
                        ) : (
                          <Moon className="w-4 h-4 text-[var(--accent)]" />
                        )}
                        <span>{t === 'oled' ? 'OLED Pitch Black' : t}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Primary Model */}
                <div className="p-4 rounded-2xl bg-[var(--bg-code)] space-y-3">
                  <div>
                    <div className="flex items-center gap-2 font-semibold text-[var(--text-primary)] text-sm"><Cpu size={16} aria-hidden="true" />Model</div>
                    <p className="text-[var(--text-muted)] mt-0.5">High-speed vs. deep architecture reasoning model.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    {[
                      { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', desc: 'Fast, lightweight daily driver' },
                      { id: 'gpt-5.4', name: 'GPT-5.4 Flagship', desc: 'Deep architectural intelligence' },
                    ].map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => onSelectModel(m.id as SupportedModel)}
                        className={`p-3 rounded-xl text-left transition-all ${
                          currentModel === m.id
                            ? 'bg-[var(--bg-card-hover)] text-[var(--text-primary)] shadow-sm ring-1 ring-[var(--bg-pill-hover)]'
                            : 'bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        <div className="font-medium text-[var(--text-primary)] text-xs">{m.name}</div>
                        <div className="text-[11px] text-[var(--text-dim)] mt-0.5">{m.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Thinking Effort */}
                <div className="p-4 rounded-2xl bg-[var(--bg-code)] space-y-3">
                  <div>
                    <div className="flex items-center gap-2 font-semibold text-[var(--text-primary)] text-sm"><Brain size={16} aria-hidden="true" />Reasoning</div>
                    <p className="text-[var(--text-muted)] mt-0.5">Depth of reasoning applied before generating response turns.</p>
                  </div>
                  <div className="grid grid-cols-5 gap-1.5 pt-1">
                    {(['none', 'low', 'medium', 'high', 'max'] as const).map((effort) => (
                      <button
                        key={effort}
                        type="button"
                        onClick={() => onSelectEffort(effort)}
                        className={`py-2 px-3 rounded-xl text-center capitalize transition-all font-medium ${
                          currentEffort === effort
                            ? 'bg-[var(--bg-card-hover)] text-[var(--text-primary)] shadow-sm ring-1 ring-[var(--bg-pill-hover)]'
                            : 'bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        {effort}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Response Verbosity */}
                <div className="p-4 rounded-2xl bg-[var(--bg-code)] space-y-3">
                  <div>
                    <div className="flex items-center gap-2 font-semibold text-[var(--text-primary)] text-sm"><MessageSquare size={16} aria-hidden="true" />Response length</div>
                    <p className="text-[var(--text-muted)] mt-0.5">Control paragraph length and response density.</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    {[
                      { id: 'low', name: 'Concise', desc: 'Direct, sharp peer answers' },
                      { id: 'medium', name: 'Balanced', desc: 'Standard explanation depth' },
                      { id: 'high', name: 'Comprehensive', desc: 'Exhaustive edge-case detail' },
                    ].map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => onSelectVerbosity(v.id as Verbosity)}
                        className={`p-3 rounded-xl text-left transition-all ${
                          currentVerbosity === v.id
                            ? 'bg-[var(--bg-card-hover)] text-[var(--text-primary)] shadow-sm ring-1 ring-[var(--bg-pill-hover)]'
                            : 'bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        <div className="font-medium text-[var(--text-primary)]">{v.name}</div>
                        <div className="text-[11px] text-[var(--text-dim)] mt-0.5">{v.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Memory Recall Budget */}
                <div className="p-4 rounded-2xl bg-[var(--bg-code)] space-y-3">
                  <div>
                    <div className="flex items-center gap-2 font-semibold text-[var(--text-primary)] text-sm"><History size={16} aria-hidden="true" />Memory recall</div>
                    <p className="text-[var(--text-muted)] mt-0.5">Depth of Hindsight memory search per conversational turn.</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    {[
                      { id: 'low', name: 'Low', desc: 'Immediate context priority' },
                      { id: 'medium', name: 'Medium', desc: 'Balanced episodic recall' },
                      { id: 'high', name: 'High', desc: 'Deep multi-session recall' },
                    ].map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => onSelectRecallBudget(b.id as RecallBudget)}
                        className={`p-3 rounded-xl text-left transition-all ${
                          currentRecallBudget === b.id
                            ? 'bg-[var(--bg-card-hover)] text-[var(--text-primary)] shadow-sm ring-1 ring-[var(--bg-pill-hover)]'
                            : 'bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        <div className="font-medium text-[var(--text-primary)]">{b.name}</div>
                        <div className="text-[11px] text-[var(--text-dim)] mt-0.5">{b.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 2. MEMORY TAB */}
            {activeTab === 'memory' && (
              <div className="flex h-full gap-4 text-xs">
                {/* Vault Tree Sidebar */}
                <div className="w-56 bg-[var(--bg-code)] rounded-2xl p-3 flex flex-col shrink-0">
                  <div className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider px-2 mb-2">
                    Vault Documents
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-1">
                    {vaultTree.map((item) => (
                      <button
                        key={item.path}
                        type="button"
                        onClick={() => handleSelectVaultDoc(item.path)}
                        className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-left transition-all truncate ${
                          selectedVaultPath === item.path
                            ? 'bg-[var(--bg-card-hover)] text-[var(--text-primary)] font-medium'
                            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
                        }`}
                      >
                        <FileText className="w-3.5 h-3.5 shrink-0 text-[var(--accent-blue)]" />
                        <span className="truncate">{item.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Vault Document Content Viewer / Editor */}
                <div className="flex-1 bg-[var(--bg-code)] rounded-2xl p-4 flex flex-col min-w-0">
                  <div className="flex items-center justify-between pb-3 mb-3 shrink-0">
                    <span className="font-mono text-[var(--text-secondary)] text-xs truncate">
                      {selectedVaultPath}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      {isEditingVaultDoc ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setIsEditingVaultDoc(false)}
                            className="px-2.5 py-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={handleSaveVaultDoc}
                            disabled={isSavingVault}
                            className="flex items-center gap-1 px-3 py-1 bg-[var(--text-primary)] text-[var(--bg-primary)] font-medium rounded-lg hover:opacity-85 transition-colors"
                          >
                            <Save className="w-3.5 h-3.5" />
                            <span>Save</span>
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setVaultDocEditDraft(vaultDocContent);
                            setIsEditingVaultDoc(true);
                          }}
                          className="flex items-center gap-1 px-2.5 py-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--bg-card)] rounded-lg transition-colors"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Edit</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto">
                    {isLoadingVault ? (
                      <div className="flex items-center justify-center h-48 text-[var(--text-dim)]">Loading document...</div>
                    ) : isEditingVaultDoc ? (
                      <textarea
                        value={vaultDocEditDraft}
                        onChange={(e) => setVaultDocEditDraft(e.target.value)}
                        className="w-full h-full bg-[var(--bg-card)] p-3 rounded-xl font-mono text-xs text-[var(--text-primary)] border-none outline-none resize-none leading-relaxed"
                      />
                    ) : (
                      <div className="prose prose-invert max-w-none text-xs leading-relaxed text-[var(--text-secondary)] font-sans">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {vaultDocContent || '_Empty document_'}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 3. PLUGINS TAB */}
            {activeTab === 'plugins' && (
              <div className="space-y-4 text-xs">
                {authError && (
                  <div className="p-3.5 rounded-2xl bg-[var(--accent-soft)] text-[var(--accent-red)] flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 text-[var(--accent-red)] shrink-0 mt-0.5" />
                    <div>{authError}</div>
                  </div>
                )}

                <div className="p-5 rounded-2xl bg-[var(--bg-code)] space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[var(--text-primary)] text-sm">Google Workspace</span>
                        {integrationStatus?.google_connected ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[var(--accent-soft)] text-[var(--accent-emerald)]">
                            <Check className="w-3 h-3" /> Connected
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-[var(--bg-card)] text-[var(--text-muted)]">
                            Not Connected
                          </span>
                        )}
                      </div>
                      <p className="text-[var(--text-muted)]">
                        Connect Google Calendar, Tasks, and Gmail for proactive briefings and email drafting.
                      </p>
                      {integrationStatus?.google_user_email && (
                        <p className="text-[var(--text-secondary)] font-mono pt-1">
                          Account: {integrationStatus.google_user_email}
                        </p>
                      )}
                    </div>

                    {integrationStatus?.google_connected ? (
                      <button
                        type="button"
                        onClick={handleDisconnectGoogle}
                        disabled={isDisconnecting}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--bg-card-hover)] hover:bg-[var(--accent-soft)] text-[var(--text-secondary)] hover:text-[var(--accent-red)] transition-colors"
                      >
                        <Unplug className="w-3.5 h-3.5" />
                        <span>Disconnect</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleConnectGoogle}
                        disabled={isConnecting}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--text-primary)] text-[var(--bg-primary)] font-semibold hover:opacity-85 transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Connect Account</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 4. SCHEDULES TAB */}
            {activeTab === 'schedules' && (
              <div className="space-y-4 text-xs">
                <div className="flex items-center justify-between pb-2">
                  <span className="text-[var(--text-muted)]">Proactive autonomous routines executed on schedule</span>
                  <button
                    type="button"
                    onClick={() => setIsCreatingSchedule(!isCreatingSchedule)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--text-primary)] text-[var(--bg-primary)] font-medium hover:opacity-85 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>New Routine</span>
                  </button>
                </div>

                {/* Create Routine Form (Friendly Time Selector - NO Cron Expression!) */}
                {isCreatingSchedule && (
                  <div className="p-4 rounded-2xl bg-[var(--bg-code)] space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-[var(--text-primary)] text-xs">Schedule New Routine</h4>
                      <div className="flex items-center gap-1 bg-[var(--bg-card)] p-0.5 rounded-xl">
                        <button
                          type="button"
                          onClick={() => setNewScheduleType('recurring')}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                            newScheduleType === 'recurring' ? 'bg-[var(--bg-card-hover)] text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
                          }`}
                        >
                          Recurring
                        </button>
                        <button
                          type="button"
                          onClick={() => setNewScheduleType('one_shot')}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                            newScheduleType === 'one_shot' ? 'bg-[var(--bg-card-hover)] text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
                          }`}
                        >
                          One-Time
                        </button>
                      </div>
                    </div>

                    {scheduleError && (
                      <p className="text-[var(--accent-red)] text-[11px]">{scheduleError}</p>
                    )}
                    <div className="space-y-2">
                      <input
                        type="text"
                        placeholder="Routine Name (e.g. Morning Briefing, Deep Work Check-in)..."
                        value={newScheduleName}
                        onChange={(e) => setNewScheduleName(e.target.value)}
                        className="w-full px-3 py-2 bg-[var(--bg-card)] rounded-xl text-[var(--text-primary)] placeholder-neutral-500 border-none outline-none text-xs"
                      />

                      {newScheduleType === 'recurring' ? (
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[var(--text-muted)] text-[11px] block mb-1">Frequency</label>
                            <select
                              value={newScheduleFrequency}
                              onChange={(e) => setNewScheduleFrequency(e.target.value as any)}
                              className="w-full px-3 py-2 bg-[var(--bg-card)] rounded-xl text-[var(--text-primary)] border-none outline-none text-xs"
                            >
                              <option value="daily">Daily</option>
                              <option value="weekdays">Weekdays (Mon-Fri)</option>
                              <option value="weekends">Weekends (Sat-Sun)</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[var(--text-muted)] text-[11px] block mb-1">Execution Time</label>
                            <input
                              type="time"
                              value={newScheduleTime}
                              onChange={(e) => setNewScheduleTime(e.target.value)}
                              className="w-full px-3 py-2 bg-[var(--bg-card)] rounded-xl text-[var(--text-primary)] border-none outline-none text-xs"
                            />
                          </div>
                        </div>
                      ) : (
                        <div>
                          <label className="text-[var(--text-muted)] text-[11px] block mb-1">Date and Time</label>
                          <input
                            type="datetime-local"
                            value={newScheduleDateTime}
                            onChange={(e) => setNewScheduleDateTime(e.target.value)}
                            className="w-full px-3 py-2 bg-[var(--bg-card)] rounded-xl text-[var(--text-primary)] border-none outline-none text-xs"
                          />
                        </div>
                      )}

                      <div>
                        <label className="text-[var(--text-muted)] text-[11px] block mb-1">Autonomous Instructions / Prompt</label>
                        <textarea
                          placeholder="What should Velocity do at this time? (e.g. Synthesize today's calendar and priority tasks)..."
                          value={newSchedulePrompt}
                          onChange={(e) => setNewSchedulePrompt(e.target.value)}
                          rows={3}
                          className="w-full p-2.5 bg-[var(--bg-card)] rounded-xl text-[var(--text-primary)] placeholder-neutral-500 border-none outline-none text-xs resize-none"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setIsCreatingSchedule(false)}
                        className="px-3 py-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleCreateSchedule}
                        disabled={isSubmittingSchedule}
                        className="px-4 py-1.5 bg-[var(--text-primary)] text-[var(--bg-primary)] font-medium rounded-xl hover:opacity-85 transition-colors"
                      >
                        {isSubmittingSchedule ? 'Saving...' : 'Save Routine'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Schedules List */}
                <div className="space-y-2">
                  {schedules.map((s) => (
                    <div
                      key={s.id}
                      className="p-4 rounded-2xl bg-[var(--bg-code)] flex items-center justify-between gap-4"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-[var(--text-primary)] text-xs">{s.name}</span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                              s.status === 'active' ? 'bg-[var(--accent-soft)] text-[var(--accent-emerald)]' : 'bg-[var(--bg-pill)] text-[var(--text-dim)]'
                            }`}
                          >
                            {s.status === 'active' ? 'Active' : 'Paused'}
                          </span>
                        </div>
                        <p className="text-[var(--text-muted)] text-[11px] truncate mt-0.5">
                          {s.prompt || 'Autonomous proactive routine'}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleToggleSchedule(s)}
                          title={s.status === 'active' ? 'Pause routine' : 'Resume routine'}
                          className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]"
                        >
                          {s.status === 'active' ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSchedule(s.id)}
                          title="Delete routine"
                          className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--accent-red)] hover:bg-[var(--bg-card)]"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 5. SKILLS TAB */}
            {activeTab === 'skills' && (
              <div className="space-y-4 text-xs">
                {editingSkill ? (
                  <div className="p-4 rounded-2xl bg-[var(--bg-code)] space-y-3">
                    <div className="flex items-center justify-between pb-2">
                      <span className="font-semibold text-[var(--text-primary)]">Edit Skill: {editingSkill.name}</span>
                      <button
                        type="button"
                        onClick={() => setEditingSkill(null)}
                        className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      >
                        Cancel
                      </button>
                    </div>
                    <textarea
                      value={skillInstructionsDraft}
                      onChange={(e) => setSkillInstructionsDraft(e.target.value)}
                      rows={10}
                      className="w-full p-3 bg-[var(--bg-card)] rounded-xl font-mono text-xs text-[var(--text-primary)] border-none outline-none resize-none leading-relaxed"
                    />
                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        onClick={handleSaveSkillInstructions}
                        disabled={isSavingSkill}
                        className="px-4 py-1.5 bg-[var(--text-primary)] text-[var(--bg-primary)] font-semibold rounded-xl hover:opacity-85 transition-colors"
                      >
                        {isSavingSkill ? 'Saving...' : 'Save Instructions'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {skills.map((sk) => (
                      <div
                        key={sk.id}
                        className="p-4 rounded-2xl bg-[var(--bg-code)] flex items-center justify-between gap-4"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-[var(--text-primary)] text-xs">{sk.name}</span>
                            {sk.slash_command && (
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--bg-card)] text-[var(--text-muted)]">
                                {sk.slash_command}
                              </span>
                            )}
                          </div>
                          <p className="text-[var(--text-muted)] text-[11px] truncate mt-0.5">
                            {sk.description || 'Specialized modular reasoning skill'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleOpenEditSkill(sk)}
                            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]"
                            title="Edit Instructions"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleSkill(sk)}
                            className={`px-2.5 py-1 rounded-xl text-[11px] font-medium transition-colors ${
                              sk.enabled ? 'bg-[var(--accent-soft)] text-[var(--accent-emerald)]' : 'bg-[var(--bg-pill)] text-[var(--text-dim)]'
                            }`}
                          >
                            {sk.enabled ? 'Enabled' : 'Disabled'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};
