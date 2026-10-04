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
  Clock,
  Sparkles,
  Plus,
  Trash2,
  Play,
  Pause,
  Edit3,
} from 'lucide-react';
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

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'general' | 'plugins' | 'memory' | 'schedules' | 'skills';
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
  const [activeTab, setActiveTab] = useState<'general' | 'plugins' | 'memory' | 'schedules' | 'skills'>(initialTab);
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatus | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(initialError);

  // Phase 5: Schedules state
  const [schedules, setSchedules] = useState<ScheduledEvent[]>([]);
  const [isLoadingSchedules, setIsLoadingSchedules] = useState(false);
  const [isCreatingSchedule, setIsCreatingSchedule] = useState(false);
  const [newScheduleName, setNewScheduleName] = useState('');
  const [newScheduleType, setNewScheduleType] = useState<'recurring' | 'one_shot'>('recurring');
  const [newSchedulePrompt, setNewSchedulePrompt] = useState('');
  const [newScheduleCron, setNewScheduleCron] = useState('0 8 * * *');
  const [newScheduleRunAt, setNewScheduleRunAt] = useState('');
  const [newScheduleSkillId, setNewScheduleSkillId] = useState('');
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [isSubmittingSchedule, setIsSubmittingSchedule] = useState(false);

  // Phase 5: Skills state
  const [skills, setSkills] = useState<Skill[]>([]);
  const [isLoadingSkills, setIsLoadingSkills] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [skillInstructionsDraft, setSkillInstructionsDraft] = useState('');
  const [isSavingSkill, setIsSavingSkill] = useState(false);

  // Sync initialTab when modal opens
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      if (initialError) {
        setAuthError(initialError);
      }
      if (initialTab === 'plugins') loadIntegrationStatus();
      if (initialTab === 'schedules') loadSchedules();
      if (initialTab === 'skills') loadSkills();
    }
  }, [isOpen, initialTab, initialError]);

  useEffect(() => {
    if (!isOpen) return;
    if (activeTab === 'plugins') loadIntegrationStatus();
    if (activeTab === 'schedules') loadSchedules();
    if (activeTab === 'skills') loadSkills();
  }, [activeTab, isOpen]);

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

  const loadSchedules = async () => {
    setIsLoadingSchedules(true);
    try {
      const data = await api.listSchedules();
      setSchedules(data);
    } catch (err: any) {
      console.error('Failed to load schedules:', err);
    } finally {
      setIsLoadingSchedules(false);
    }
  };

  const loadSkills = async () => {
    setIsLoadingSkills(true);
    try {
      const data = await api.listSkills();
      setSkills(data);
    } catch (err: any) {
      console.error('Failed to load skills:', err);
    } finally {
      setIsLoadingSkills(false);
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

  const handleToggleSchedule = async (sched: ScheduledEvent) => {
    const nextStatus = sched.status === 'active' ? 'paused' : 'active';
    try {
      await api.updateSchedule(sched.id, { status: nextStatus });
      await loadSchedules();
    } catch (err) {
      console.error('Failed to toggle schedule:', err);
    }
  };

  const handleDeleteSchedule = async (schedId: string) => {
    try {
      await api.deleteSchedule(schedId);
      await loadSchedules();
    } catch (err) {
      console.error('Failed to delete schedule:', err);
    }
  };

  const handleCreateScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newScheduleName.trim() || !newSchedulePrompt.trim()) {
      setScheduleError('Name and prompt directive are required.');
      return;
    }
    setScheduleError(null);
    setIsSubmittingSchedule(true);
    try {
      await api.createSchedule({
        name: newScheduleName.trim(),
        event_type: newScheduleType,
        prompt: newSchedulePrompt.trim(),
        cron_expression: newScheduleType === 'recurring' ? newScheduleCron.trim() : undefined,
        run_at: newScheduleType === 'one_shot' ? newScheduleRunAt.trim() : undefined,
        skill_id: newScheduleSkillId.trim() || undefined,
        session_id: 'main',
      });
      setIsCreatingSchedule(false);
      setNewScheduleName('');
      setNewSchedulePrompt('');
      await loadSchedules();
    } catch (err: any) {
      setScheduleError(err.message || 'Failed to create schedule');
    } finally {
      setIsSubmittingSchedule(false);
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
        <div className="flex items-center px-6 border-b border-zinc-800 bg-[#09090b] text-sm overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => setActiveTab('plugins')}
            className={`flex items-center gap-2 py-3 px-3 font-medium border-b-2 whitespace-nowrap transition-colors ${
              activeTab === 'plugins'
                ? 'border-zinc-100 text-zinc-100'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Puzzle className="w-4 h-4" />
            Plugins
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('schedules')}
            className={`flex items-center gap-2 py-3 px-3 font-medium border-b-2 whitespace-nowrap transition-colors ${
              activeTab === 'schedules'
                ? 'border-zinc-100 text-zinc-100'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Clock className="w-4 h-4" />
            Schedules
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('skills')}
            className={`flex items-center gap-2 py-3 px-3 font-medium border-b-2 whitespace-nowrap transition-colors ${
              activeTab === 'skills'
                ? 'border-zinc-100 text-zinc-100'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            Skills
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('general')}
            className={`flex items-center gap-2 py-3 px-3 font-medium border-b-2 whitespace-nowrap transition-colors ${
              activeTab === 'general'
                ? 'border-zinc-100 text-zinc-100'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Sliders className="w-4 h-4" />
            General
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('memory')}
            className={`flex items-center gap-2 py-3 px-3 font-medium border-b-2 whitespace-nowrap transition-colors ${
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
                <div className="p-3.5 rounded-xl border border-red-500/30 bg-red-950/20 text-red-200 text-xs flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <div className="leading-relaxed">{authError}</div>
                </div>
              )}

              {/* Google Workspace Card */}
              <div className="p-5 rounded-2xl border border-zinc-800 bg-[#0c0c0e] space-y-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-zinc-100 text-sm">Google Workspace</span>
                      {integrationStatus?.google_connected ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-950/40 text-emerald-400 border border-emerald-800/40">
                          <Check className="w-3 h-3" /> Connected
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-zinc-800 text-zinc-400 border border-zinc-700/50">
                          Not Connected
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-400">
                      Connect Google Calendar, Tasks, and Gmail for seamless scheduling and communications.
                    </p>
                    {integrationStatus?.google_user_email && (
                      <p className="text-xs text-zinc-300 font-mono pt-1">
                        Account: {integrationStatus.google_user_email}
                      </p>
                    )}
                  </div>

                  <div>
                    {isLoadingStatus ? (
                      <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
                    ) : integrationStatus?.google_connected ? (
                      <button
                        type="button"
                        onClick={handleDisconnectGoogle}
                        disabled={isDisconnecting}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 bg-red-950/20 text-red-300 hover:bg-red-950/40 text-xs font-medium transition-colors disabled:opacity-50"
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
                        onClick={handleConnectGoogle}
                        disabled={isConnecting}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-zinc-100 text-zinc-900 hover:bg-white text-xs font-semibold transition-colors disabled:opacity-50"
                      >
                        {isConnecting ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-900" />
                        ) : (
                          <ExternalLink className="w-3.5 h-3.5" />
                        )}
                        Connect Google Account
                      </button>
                    )}
                  </div>
                </div>

                {/* Sub-services breakdown */}
                <div className="pt-2 border-t border-zinc-800/80 grid grid-cols-3 gap-2.5">
                  <div className="p-2.5 rounded-xl border border-zinc-800/60 bg-[#09090b] flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-blue-400" />
                    <div className="text-[11px]">
                      <div className="font-medium text-zinc-200">Calendar</div>
                      <div className="text-zinc-500 text-[10px]">
                        {integrationStatus?.services?.calendar ? 'Active' : 'Disconnected'}
                      </div>
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl border border-zinc-800/60 bg-[#09090b] flex items-center gap-2">
                    <CheckSquare className="w-4 h-4 text-emerald-400" />
                    <div className="text-[11px]">
                      <div className="font-medium text-zinc-200">Tasks</div>
                      <div className="text-zinc-500 text-[10px]">
                        {integrationStatus?.services?.tasks ? 'Active' : 'Disconnected'}
                      </div>
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl border border-zinc-800/60 bg-[#09090b] flex items-center gap-2">
                    <Mail className="w-4 h-4 text-amber-400" />
                    <div className="text-[11px]">
                      <div className="font-medium text-zinc-200">Gmail</div>
                      <div className="text-zinc-500 text-[10px]">
                        {integrationStatus?.services?.gmail ? 'Active' : 'Disconnected'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Policy description */}
                <div className="pt-1 text-[11px] text-zinc-500 leading-normal">
                  Frictionless operations: Reading calendar/tasks/emails, booking events, creating tasks, and saving drafts execute automatically. Sending emails directly to recipients requires explicit in-chat approval.
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: SCHEDULES */}
          {activeTab === 'schedules' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-sm text-zinc-100">Proactive Schedules & Timed Reminders</h3>
                  <p className="text-xs text-zinc-400">
                    Velocity triggers autonomous briefings and tasks based on crons and timestamps (Asia/Kolkata).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCreatingSchedule(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-900 hover:bg-white text-xs font-semibold transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Schedule
                </button>
              </div>

              {/* Create Schedule Modal Form */}
              {isCreatingSchedule && (
                <form
                  onSubmit={handleCreateScheduleSubmit}
                  className="p-4 rounded-xl border border-zinc-700 bg-[#0c0c0e] space-y-3.5 text-xs animate-fade-in"
                >
                  <div className="flex items-center justify-between font-semibold text-zinc-200">
                    <span>Create New Schedule</span>
                    <button
                      type="button"
                      onClick={() => setIsCreatingSchedule(false)}
                      className="text-zinc-500 hover:text-zinc-300"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {scheduleError && (
                    <div className="p-2 rounded-lg bg-red-950/30 border border-red-500/30 text-red-300 text-[11px]">
                      {scheduleError}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-zinc-400 mb-1">Name</label>
                      <input
                        type="text"
                        value={newScheduleName}
                        onChange={(e) => setNewScheduleName(e.target.value)}
                        placeholder="e.g. Daily Tech Briefing"
                        className="w-full px-3 py-1.5 rounded-lg bg-[#09090b] border border-zinc-800 text-zinc-100 text-xs focus:outline-none focus:border-zinc-500"
                      />
                    </div>
                    <div>
                      <label className="block text-zinc-400 mb-1">Type</label>
                      <select
                        value={newScheduleType}
                        onChange={(e) => setNewScheduleType(e.target.value as any)}
                        className="w-full px-3 py-1.5 rounded-lg bg-[#09090b] border border-zinc-800 text-zinc-100 text-xs focus:outline-none focus:border-zinc-500"
                      >
                        <option value="recurring">Recurring (Cron)</option>
                        <option value="one_shot">One-Shot Reminder</option>
                      </select>
                    </div>
                  </div>

                  {newScheduleType === 'recurring' ? (
                    <div>
                      <label className="block text-zinc-400 mb-1">Cron Expression (5-field)</label>
                      <input
                        type="text"
                        value={newScheduleCron}
                        onChange={(e) => setNewScheduleCron(e.target.value)}
                        placeholder="0 8 * * * (8:00 AM daily)"
                        className="w-full px-3 py-1.5 rounded-lg bg-[#09090b] border border-zinc-800 text-zinc-100 font-mono text-xs focus:outline-none focus:border-zinc-500"
                      />
                      <span className="text-[10px] text-zinc-500 mt-1 block">
                        Example: <code>0 8 * * *</code> = 08:00 AM daily, <code>0 21 * * *</code> = 09:00 PM daily.
                      </span>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-zinc-400 mb-1">Run At (ISO timestamp)</label>
                      <input
                        type="text"
                        value={newScheduleRunAt}
                        onChange={(e) => setNewScheduleRunAt(e.target.value)}
                        placeholder="2026-10-04T22:00:00"
                        className="w-full px-3 py-1.5 rounded-lg bg-[#09090b] border border-zinc-800 text-zinc-100 font-mono text-xs focus:outline-none focus:border-zinc-500"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-zinc-400 mb-1">Prompt Directive to Execute</label>
                    <textarea
                      value={newSchedulePrompt}
                      onChange={(e) => setNewSchedulePrompt(e.target.value)}
                      placeholder="e.g. Synthesize today's morning briefing, book focus block on calendar, and stage task in Google Tasks."
                      rows={2}
                      className="w-full px-3 py-1.5 rounded-lg bg-[#09090b] border border-zinc-800 text-zinc-100 text-xs focus:outline-none focus:border-zinc-500"
                    />
                  </div>

                  <div>
                    <label className="block text-zinc-400 mb-1">Optional Associated Skill</label>
                    <select
                      value={newScheduleSkillId}
                      onChange={(e) => setNewScheduleSkillId(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg bg-[#09090b] border border-zinc-800 text-zinc-100 text-xs focus:outline-none focus:border-zinc-500"
                    >
                      <option value="">None (Standard Persona)</option>
                      {skills.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.id})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setIsCreatingSchedule(false)}
                      className="px-3 py-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 text-xs"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmittingSchedule}
                      className="px-3.5 py-1.5 rounded-lg bg-zinc-100 text-zinc-900 font-semibold text-xs hover:bg-white disabled:opacity-50"
                    >
                      {isSubmittingSchedule ? 'Saving...' : 'Save Schedule'}
                    </button>
                  </div>
                </form>
              )}

              {/* Schedules List */}
              {isLoadingSchedules ? (
                <div className="flex items-center justify-center p-8 text-zinc-500 text-xs gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading schedules...
                </div>
              ) : schedules.length === 0 ? (
                <div className="p-8 text-center rounded-2xl border border-zinc-800/80 bg-[#0c0c0e] text-zinc-400 text-xs space-y-1">
                  <p className="font-medium text-zinc-300">No scheduled routines yet</p>
                  <p className="text-zinc-500">
                    Ask Velocity in chat (e.g. "Give me a briefing every morning at 8am") or click "Add Schedule" above.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {schedules.map((sched) => (
                    <div
                      key={sched.id}
                      className="p-4 rounded-xl border border-zinc-800 bg-[#0c0c0e] flex items-center justify-between text-xs"
                    >
                      <div className="space-y-1 max-w-[70%]">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-zinc-100">{sched.name}</span>
                          <span className="px-1.5 py-0.5 rounded font-mono text-[10px] bg-zinc-800 text-zinc-300">
                            {sched.event_type === 'recurring' ? sched.cron_expression : 'One-Shot'}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              sched.status === 'active'
                                ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-800/40'
                                : 'bg-zinc-800 text-zinc-400'
                            }`}
                          >
                            {sched.status}
                          </span>
                        </div>
                        <p className="text-zinc-400 line-clamp-1">{sched.prompt}</p>
                        {sched.next_run_at && (
                          <p className="text-[11px] text-zinc-500 font-mono">
                            Next Run: {new Date(sched.next_run_at).toLocaleString()}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleToggleSchedule(sched)}
                          title={sched.status === 'active' ? 'Pause schedule' : 'Resume schedule'}
                          className="p-1.5 rounded-lg border border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
                        >
                          {sched.status === 'active' ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSchedule(sched.id)}
                          title="Delete schedule"
                          className="p-1.5 rounded-lg border border-zinc-800 text-zinc-400 hover:text-red-400 hover:bg-red-950/20 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: MODULAR SKILLS */}
          {activeTab === 'skills' && (
            <div className="space-y-5">
              <div>
                <h3 className="font-semibold text-sm text-zinc-100">Modular Skills Architecture</h3>
                <p className="text-xs text-zinc-400">
                  Skills located in <code>data/skills/</code>. Velocity dynamically mounts procedural instructions based on user intent or slash commands.
                </p>
              </div>

              {/* Instructions Editor Drawer */}
              {editingSkill && (
                <div className="p-4 rounded-xl border border-zinc-700 bg-[#0c0c0e] space-y-3 text-xs animate-fade-in">
                  <div className="flex items-center justify-between font-semibold text-zinc-200">
                    <span>Skill Instructions: {editingSkill.name}</span>
                    <button
                      type="button"
                      onClick={() => setEditingSkill(null)}
                      className="text-zinc-500 hover:text-zinc-300"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <textarea
                    value={skillInstructionsDraft}
                    onChange={(e) => setSkillInstructionsDraft(e.target.value)}
                    rows={8}
                    className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-zinc-100 font-mono text-[11px] focus:outline-none focus:border-zinc-500 leading-relaxed"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingSkill(null)}
                      className="px-3 py-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 text-xs"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveSkillInstructions}
                      disabled={isSavingSkill}
                      className="px-3.5 py-1.5 rounded-lg bg-zinc-100 text-zinc-900 font-semibold text-xs hover:bg-white disabled:opacity-50"
                    >
                      {isSavingSkill ? 'Saving...' : 'Save Instructions'}
                    </button>
                  </div>
                </div>
              )}

              {/* Skills List */}
              {isLoadingSkills ? (
                <div className="flex items-center justify-center p-8 text-zinc-500 text-xs gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading skills...
                </div>
              ) : (
                <div className="space-y-3">
                  {skills.map((skill) => (
                    <div
                      key={skill.id}
                      className="p-4 rounded-xl border border-zinc-800 bg-[#0c0c0e] flex items-start justify-between text-xs gap-4"
                    >
                      <div className="space-y-1.5 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-zinc-100">{skill.name}</span>
                          <span className="px-1.5 py-0.5 rounded font-mono text-[10px] bg-zinc-800 text-zinc-300">
                            {skill.id}
                          </span>
                          {skill.slash_command && (
                            <span className="px-1.5 py-0.5 rounded font-mono text-[10px] bg-blue-950/40 text-blue-400 border border-blue-800/40">
                              {skill.slash_command}
                            </span>
                          )}
                        </div>
                        <p className="text-zinc-400 text-xs leading-relaxed">{skill.description}</p>
                        {skill.allowed_tools && skill.allowed_tools.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-1">
                            {skill.allowed_tools.map((tool) => (
                              <span
                                key={tool}
                                className="px-1.5 py-0.2 rounded text-[10px] bg-zinc-900 text-zinc-500 border border-zinc-800"
                              >
                                {tool}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0 pt-1">
                        <button
                          type="button"
                          onClick={() => handleOpenEditSkill(skill)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-zinc-800 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 text-xs transition-colors"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          Instructions
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleSkill(skill)}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                            skill.enabled
                              ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/40'
                              : 'bg-zinc-900 text-zinc-500 border-zinc-800'
                          }`}
                        >
                          {skill.enabled ? 'Enabled' : 'Disabled'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: GENERAL & MODEL */}
          {activeTab === 'general' && (
            <div className="space-y-6 text-xs">
              {/* Preferred Model */}
              <div className="space-y-2">
                <label className="font-semibold text-zinc-300 block">Default Primary Model</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['gpt-5.4-mini', 'gpt-5.4', 'gpt-5.6', 'gpt-5.6-luna'] as SupportedModel[]).map((mod) => (
                    <button
                      key={mod}
                      type="button"
                      onClick={() => onSelectModel(mod)}
                      className={`p-3 rounded-xl border text-left flex flex-col gap-1 transition-colors ${
                        currentModel === mod
                          ? 'border-zinc-200 bg-zinc-900 text-zinc-100'
                          : 'border-zinc-800 bg-[#0c0c0e] text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                      }`}
                    >
                      <span className="font-medium text-sm text-zinc-100">{mod}</span>
                      <span className="text-[11px] text-zinc-500">
                        {mod.includes('mini') ? 'Fast & lightweight' : 'High-capacity reasoning'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Reasoning Effort */}
              <div className="space-y-2">
                <label className="font-semibold text-zinc-300 block">Thinking / Reasoning Effort</label>
                <div className="flex gap-2">
                  {(['low', 'medium', 'high'] as ThinkingEffort[]).map((effort) => (
                    <button
                      key={effort}
                      type="button"
                      onClick={() => onSelectEffort(effort)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-medium capitalize transition-colors ${
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

          {/* TAB 5: MEMORY VAULT */}
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
