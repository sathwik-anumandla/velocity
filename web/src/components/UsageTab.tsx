import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, RefreshCw, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';

interface UsagePeriod {
  model?: string;
  source?: string;
  conversation_kind?: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  reasoning_reported: number;
  cached_tokens: number;
  cache_write_tokens: number;
  cache_hit_rate: number;
  cache_reported: number;
  cache_savings_usd: number;
  cache_hit_calls: number;
  reasoning_share: number;
  cost_usd: number;
  reserved_usd: number;
  unpriced_calls: number;
  unreported_calls: number;
}

interface DailyUsage {
  date: string;
  calls: number;
  total_tokens: number;
  cost_usd: number;
  unpriced_calls: number;
  unreported_calls: number;
}

type Rates = Record<string, { input: number; cached_input: number; output: number }>;
type Range = 'today' | 'month' | 'all_time';
type Metric = 'tokens' | 'cost' | 'calls';
interface Breakdown { by_model: UsagePeriod[]; by_source: UsagePeriod[]; by_conversation?: UsagePeriod[] }

interface UsageStats {
  settings: { prices: Rates };
  today: UsagePeriod;
  month: UsagePeriod;
  all_time: UsagePeriod;
  by_model: UsagePeriod[];
  by_source: UsagePeriod[];
  breakdowns?: Partial<Record<Range, Breakdown>>;
  daily?: DailyUsage[];
  coverage: string;
}

const ranges: { id: Range; label: string }[] = [{ id: 'today', label: 'Today' }, { id: 'month', label: 'This month' }, { id: 'all_time', label: 'All time' }];
const count = (value: number) => value.toLocaleString();
const usd = (value: number) => `$${value.toFixed(value === 0 || value >= 1 ? 2 : value >= 0.01 ? 4 : 6)}`;
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const dateLabel = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const sourceLabel = (source: string) => ({ chat: 'Conversations', scheduled: 'Scheduled routines', title: 'Chat titles', summary: 'Context summaries', rollup: 'Thread summaries', synthesis: 'Memory synthesis' }[source] || source.replaceAll('_', ' '));

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return <section className="rounded-2xl bg-[var(--bg-code)] p-4 sm:p-5 space-y-4">
    <div><h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>{note && <p className="mt-1 text-xs text-[var(--text-muted)]">{note}</p>}</div>
    {children}
  </section>;
}

function Overview({ period }: { period: UsagePeriod }) {
  return <section className="rounded-2xl bg-[var(--bg-code)] p-5 sm:p-6">
    <p className="text-xs font-medium text-[var(--text-muted)]">Estimated spending</p>
    <p className="mt-2 text-4xl font-semibold tracking-tight tabular-nums text-[var(--text-primary)]">{period.unpriced_calls > 0 && period.cost_usd === 0 ? 'Unpriced' : usd(period.cost_usd)}</p>
    <p className="mt-2 text-xs text-[var(--text-muted)]">USD · priced model calls only</p>
    <dl className="mt-6 grid grid-cols-3 gap-3 border-t border-[var(--bg-pill)] pt-4">
      {[
        ['Total tokens', count(period.input_tokens + period.output_tokens)],
        ['API calls', count(period.calls)],
        ['Cache savings', usd(period.cache_savings_usd)],
      ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-[11px] text-[var(--text-muted)]">{label}</dt><dd className="mt-1 break-words text-sm font-semibold tabular-nums text-[var(--text-primary)]">{value}</dd></div>)}
    </dl>
  </section>;
}

function TokenMix({ period }: { period: UsagePeriod }) {
  return <Panel title="Tokens" note="Cached input and reasoning are subsets, not additional tokens.">
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {[
        { title: 'Input', count: period.input_tokens, subset: 'Cached input', value: period.cached_tokens, reported: period.cache_reported, share: period.cache_hit_rate, color: 'var(--accent-blue)', note: 'of reported input served from cache' },
        { title: 'Output', count: period.output_tokens, subset: 'Reasoning', value: period.reasoning_tokens, reported: period.reasoning_reported, share: period.reasoning_share, color: 'var(--accent-violet)', note: 'of reported output used for reasoning' },
      ].map(group => <section key={group.title} className="rounded-xl bg-[var(--bg-card)] p-4">
        <p className="flex items-center gap-2 text-xs font-medium text-[var(--text-muted)]"><span className="h-2 w-2 rounded-full" style={{ background: group.color }} />{group.title} tokens</p>
        <p className="mt-2 break-all text-2xl font-semibold tracking-tight tabular-nums text-[var(--text-primary)]">{count(group.count)}</p>
        <dl className="mt-4 border-t border-[var(--bg-pill)] pt-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2"><dt className="text-xs text-[var(--text-muted)]">{group.subset}</dt><dd className="text-sm font-semibold tabular-nums text-[var(--text-primary)]">{group.reported > 0 ? count(group.value) : 'Not reported'}</dd></div>
        </dl>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-[var(--bg-pill)]" role="img" aria-label={group.reported ? `${percent(group.share)} ${group.note}` : 'Provider breakdown not reported'}>
          <div className="h-full rounded-full" style={{ width: group.reported ? percent(Math.min(1, Math.max(0, group.share))) : '0%', background: group.color }} />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-muted)]">{group.reported ? `${percent(group.share)} ${group.note} · ${count(group.reported)} reporting calls` : 'Your provider has not reported this breakdown.'}</p>
      </section>)}
    </div>
    {period.cache_reported > 0 && period.cache_write_tokens > 0 && <p className="text-xs text-[var(--text-muted)]">Cache writes: {count(period.cache_write_tokens)} tokens · reported separately</p>}
  </Panel>;
}

function ActivityBreakdown({ breakdown, note }: { breakdown: Breakdown; note: string }) {
  const [group, setGroup] = useState<'model' | 'source'>('model');
  return <div className="space-y-3">
    <div className="flex gap-1 rounded-xl bg-[var(--bg-code)] p-1" role="group" aria-label="Usage breakdown">
      {(['model', 'source'] as const).map(option => <button key={option} aria-pressed={group === option} onClick={() => setGroup(option)} className={`flex-1 rounded-lg py-2.5 text-xs font-medium ${group === option ? 'bg-[var(--bg-pill-hover)] text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>{option === 'model' ? 'By model' : 'By activity'}</button>)}
    </div>
    <BreakdownChart title={group === 'model' ? 'Models' : 'Activity'} note={note} rows={group === 'model' ? breakdown.by_model : breakdown.by_source} field={group} />
  </div>;
}

function DailyChart({ days }: { days: DailyUsage[] }) {
  const [metric, setMetric] = useState<Metric>('tokens');
  const [selected, setSelected] = useState<string | null>(null);
  const selectedIndex = Math.max(0, selected ? days.findIndex(day => day.date === selected) : days.length - 1);
  const day = days[selectedIndex];
  const value = (entry: DailyUsage) => metric === 'cost' ? entry.cost_usd : metric === 'calls' ? entry.calls : entry.total_tokens;
  const maximum = Math.max(...days.map(value), 0);
  const display = (amount: number) => metric === 'cost' ? usd(amount) : count(amount);
  return <Panel title="Daily activity" note="Last 30 days · UTC · tracked usage only">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex rounded-lg bg-[var(--bg-card)] p-1" role="group" aria-label="Chart metric">
        {(['tokens', 'cost', 'calls'] as Metric[]).map(option => <button key={option} aria-pressed={metric === option} onClick={() => setMetric(option)} className={`rounded-md px-3 py-2 text-xs capitalize ${metric === option ? 'bg-[var(--bg-pill-hover)] text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>{option}</button>)}
      </div>
      <span className="text-[11px] text-[var(--text-muted)]">Peak: {display(maximum)}</span>
    </div>
    {!day ? <p className="py-6 text-center text-[var(--text-muted)]">Update the backend to enable daily history.</p> : <>
      <div className="relative">
        <div aria-hidden="true" className="absolute inset-x-0 top-0 bottom-0 flex flex-col justify-between"><div className="border-t border-[var(--bg-pill)]" /><div className="border-t border-[var(--bg-pill)]" /><div className="border-t border-[var(--bg-pill)]" /></div>
        <div className="relative flex h-32 items-end gap-1" role="group" aria-label={`Daily ${metric}. Choose a day for details.`}>
          {days.map(entry => <button key={entry.date} aria-pressed={day.date === entry.date} aria-label={`${dateLabel(entry.date)}: ${display(value(entry))} ${metric === 'cost' ? 'USD estimated' : metric}`} title={`${dateLabel(entry.date)} · ${display(value(entry))}`} onClick={() => setSelected(entry.date)} className="group flex h-full min-w-0 flex-1 items-end rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--text-primary)]">
            <span className={`w-full rounded-t-sm ${entry.date === day.date ? 'bg-[var(--accent-soft)]' : 'bg-[var(--bg-pill-hover)] group-hover:bg-[var(--text-muted)]'}`} style={{ height: `${maximum ? Math.max(2, value(entry) / maximum * 100) : 2}%` }} />
          </button>)}
        </div>
      </div>
      <div className="flex justify-between text-[11px] text-[var(--text-dim)]"><span>{dateLabel(days[0].date)}</span><span>{dateLabel(days[days.length - 1].date)}</span></div>
      <div className="flex items-center gap-3 rounded-xl bg-[var(--bg-card)] p-3">
        <button aria-label="Previous day" disabled={selectedIndex === 0} onClick={() => setSelected(days[selectedIndex - 1].date)} className="p-2 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-pill)] disabled:opacity-30"><ArrowLeft size={16} /></button>
        <div className="min-w-0 flex-1 text-center" aria-live="polite"><p className="text-xs text-[var(--text-primary)]">{dateLabel(day.date)} · {display(value(day))} {metric === 'cost' ? 'estimated' : metric}</p><p className="mt-1 text-[11px] text-[var(--text-muted)]">{count(day.calls)} calls{day.unpriced_calls > 0 ? ` · ${day.unpriced_calls} unpriced` : ''}{day.unreported_calls > 0 ? ` · ${day.unreported_calls} missing usage` : ''}</p></div>
        <button aria-label="Next day" disabled={selectedIndex === days.length - 1} onClick={() => setSelected(days[selectedIndex + 1].date)} className="p-2 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-pill)] disabled:opacity-30"><ArrowRight size={16} /></button>
      </div>
      {!maximum && <p className="text-xs text-[var(--text-muted)]">{metric === 'cost' ? 'No priced spending recorded in this window. Unpriced calls are not free calls.' : 'No tracked activity for this metric in this window.'}</p>}
    </>}
  </Panel>;
}

function BreakdownChart({ title, rows, field, note }: { title: string; rows: UsagePeriod[]; field: 'model' | 'source'; note: string }) {
  const [metric, setMetric] = useState<'cost' | 'calls'>('calls');
  const sorted = [...rows].sort((first, second) => metric === 'cost' ? second.cost_usd - first.cost_usd : second.calls - first.calls);
  const maximum = Math.max(...rows.map(row => metric === 'cost' ? row.cost_usd : row.calls), 0);
  return <Panel title={title} note={note}>
    <div className="flex gap-2" role="group" aria-label={`${title} metric`}>
      {(['calls', 'cost'] as const).map(option => <button key={option} aria-pressed={metric === option} onClick={() => setMetric(option)} className={`rounded-lg px-3 py-2 text-xs capitalize ${metric === option ? 'bg-[var(--bg-pill-hover)] text-[var(--text-primary)]' : 'bg-[var(--bg-card)] text-[var(--text-muted)]'}`}>{option}</button>)}
    </div>
    {sorted.length === 0 && <p className="py-3 text-[var(--text-muted)]">No tracked calls in this period.</p>}
    <ul className="space-y-4">{sorted.map(row => {
      const amount = metric === 'cost' ? row.cost_usd : row.calls;
      const label = field === 'source' ? sourceLabel(row.source || 'Unknown') : row.model || 'Unknown model';
      return <li key={row[field]} className="space-y-2">
        <div className="flex items-baseline justify-between gap-3 text-xs"><span className="min-w-0 break-all text-[var(--text-secondary)]">{label}</span><span className="shrink-0 text-[var(--text-primary)] tabular-nums">{metric === 'cost' ? usd(amount) : `${count(amount)} calls`}</span></div>
        <div role="img" aria-label={`${label}: ${metric === 'cost' ? usd(amount) : count(amount)} ${metric}`} className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-pill)]"><div className="h-full rounded-full bg-[var(--text-muted)]" style={{ width: `${maximum ? amount / maximum * 100 : 0}%` }} /></div>
        {row.unpriced_calls > 0 && <p className="text-[11px] text-[var(--accent-amber)]">{row.unpriced_calls} calls have no configured price</p>}
      </li>;
    })}</ul>
  </Panel>;
}

function PricingEditor({ rates, busy, error, onSave, onDirty }: { rates: Rates; busy: boolean; error: string | null; onSave: (rates: Rates) => void; onDirty: (dirty: boolean) => void }) {
  const initial = () => Object.fromEntries(Object.entries(rates).map(([name, rate]) => [name, { input: String(rate.input), cached_input: String(rate.cached_input), output: String(rate.output) }]));
  const [draft, setDraft] = useState(initial);
  const [name, setName] = useState('');
  const [validation, setValidation] = useState<string | null>(null);
  return <details className="rounded-2xl bg-[var(--bg-code)] p-4 group">
    <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-[var(--text-primary)]">Model pricing <ChevronDown size={16} className="text-[var(--text-muted)] group-open:rotate-180" /></summary>
    <p className="mt-3 text-xs leading-relaxed text-[var(--text-muted)]">Optional provider rates in USD per million tokens. Changes affect future calls, not past estimates. Reset/remove restores a default rate when available. No spending limits are enforced.</p>
    <form className="mt-4 space-y-4" onSubmit={event => {
      event.preventDefault();
      try {
        const prepared: Rates = {};
        for (const [model, rate] of Object.entries(draft)) {
          const parsed = Object.fromEntries(Object.entries(rate).map(([key, value]) => {
            if (!value.trim() || !Number.isFinite(Number(value)) || Number(value) < 0) throw new Error('Enter a nonnegative number for every price.');
            return [key, Number(value)];
          })) as Rates[string];
          prepared[model] = parsed;
        }
        setValidation(null);
        onSave(prepared);
      } catch (failure) { setValidation(failure instanceof Error ? failure.message : 'Invalid prices'); }
    }}>
      {Object.entries(draft).map(([model, rate]) => <fieldset key={model} className="min-w-0 rounded-xl bg-[var(--bg-card)] p-3">
        <legend className="px-1 text-xs text-[var(--text-secondary)] break-all">{model}</legend>
        <button type="button" disabled={busy} aria-label={`Reset or remove ${model} price`} onClick={() => { setDraft(Object.fromEntries(Object.entries(draft).filter(([key]) => key !== model))); onDirty(true); }} className="mb-2 rounded-lg py-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]">Reset/remove rate</button>
        <div className="grid grid-cols-3 gap-2">{(['input', 'cached_input', 'output'] as const).map(field => <label key={field} className="min-w-0 text-[11px] text-[var(--text-muted)]">{field === 'cached_input' ? 'Cached input' : field === 'input' ? 'Input' : 'Output'}<input aria-label={`${model} ${field} price`} type="number" min="0" step="any" required disabled={busy} value={rate[field]} onChange={event => { setDraft({ ...draft, [model]: { ...rate, [field]: event.target.value } }); onDirty(true); }} className="mt-1 w-full rounded-lg bg-[var(--bg-code)] p-2 text-[var(--text-primary)] tabular-nums focus:outline-none focus:ring-1 focus:ring-neutral-500" /></label>)}</div>
      </fieldset>)}
      <div className="flex flex-wrap gap-2"><input aria-label="New model name" placeholder="Custom model ID" value={name} onChange={event => setName(event.target.value)} className="min-w-0 flex-1 rounded-lg bg-[var(--bg-card)] p-2 text-xs text-[var(--text-primary)]" /><button type="button" disabled={busy || !name.trim() || name.trim() in draft} onClick={() => { setDraft({ ...draft, [name.trim()]: { input: '', cached_input: '', output: '' } }); setName(''); onDirty(true); }} className="rounded-lg bg-[var(--bg-pill)] px-3 py-2 text-xs disabled:opacity-40">Add model</button></div>
      {validation && <p role="alert" className="text-xs text-[var(--accent-red)]">{validation}</p>}
      {error && <p role="alert" className="text-xs text-[var(--accent-red)]">{error}</p>}
      <div className="flex gap-2"><button disabled={busy} className="rounded-lg bg-[var(--text-primary)] px-4 py-2 text-xs font-semibold text-[var(--bg-primary)] disabled:opacity-40">Save rates</button><button disabled={busy} type="button" onClick={() => { setDraft(initial()); setValidation(null); onDirty(false); }} className="rounded-lg px-3 py-2 text-xs text-[var(--text-muted)]">Discard edits</button></div>
    </form>
  </details>;
}

export function UsageTab() {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [range, setRange] = useState<Range>('today');
  const [error, setError] = useState<string | null>(null);
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [updated, setUpdated] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/usage', { signal: controller.signal, cache: 'no-store' })
      .then(async response => { if (!response.ok) throw new Error(`Usage unavailable (HTTP ${response.status})`); return response.json() as Promise<UsageStats>; })
      .then(value => { setStats(value); setUpdated(new Date().toLocaleTimeString()); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Usage unavailable'); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, []);

  const request = async (rates?: Rates) => {
    setBusy(true);
    setSaved(false);
    try {
      const response = await fetch(rates ? '/api/usage/prices' : '/api/usage', rates ? { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prices: rates }) } : { cache: 'no-store' });
      if (!response.ok) throw new Error(`Usage request failed (HTTP ${response.status})`);
      setStats(await response.json());
      setUpdated(new Date().toLocaleTimeString());
      setError(null);
      setPricingError(null);
      setDirty(false);
      setSaved(Boolean(rates));
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'Usage unavailable';
      if (rates) setPricingError(message); else setError(message);
    }
    finally { setBusy(false); }
  };
  const period = stats?.[range];
  const breakdown = stats?.breakdowns?.[range] || (stats ? { by_model: stats.by_model, by_source: stats.by_source } : null);
  const breakdownNote = stats?.breakdowns?.[range] ? ranges.find(option => option.id === range)!.label : 'All time · update backend for period filtering';

  return <div className="space-y-4 text-[var(--text-secondary)] select-text" aria-busy={busy}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-sm font-medium text-[var(--text-primary)]">Your AI activity, at a glance</p><p className="mt-1 text-xs text-[var(--text-muted)]">USD estimates · periods use UTC{updated ? ` · updated ${updated}` : ''}</p></div>
      <button disabled={busy || dirty} title={dirty ? 'Save or discard pricing edits before refreshing' : 'Refresh usage'} onClick={() => void request()} className="flex items-center gap-2 rounded-xl bg-[var(--bg-pill)] px-3 py-2 text-xs text-[var(--text-primary)] disabled:opacity-40"><RefreshCw size={14} className={busy ? 'motion-safe:animate-spin' : ''} />{busy ? 'Loading' : 'Refresh'}</button>
    </div>
    <div className="flex rounded-xl bg-[var(--bg-code)] p-1" role="group" aria-label="Usage overview period">{ranges.map(option => <button key={option.id} aria-pressed={range === option.id} onClick={() => setRange(option.id)} className={`flex-1 rounded-lg px-2 py-2.5 text-xs font-medium ${range === option.id ? 'bg-[var(--bg-pill-hover)] text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>{option.label}</button>)}</div>
    {error && <div role="alert" className="rounded-xl bg-[var(--accent-soft)] p-3 text-xs text-[var(--accent-red)]">{stats ? 'Refresh failed. Showing the last loaded data. ' : ''}{error}{!stats && <button onClick={() => void request()} disabled={busy} className="ml-2 underline">Try again</button>}</div>}
    {busy && !stats && <div className="grid grid-cols-2 gap-3" aria-label="Loading usage">{[0, 1, 2, 3].map(index => <div key={index} className="h-28 rounded-2xl bg-[var(--bg-code)] motion-safe:animate-pulse" />)}</div>}
    {stats && period && <>
      {stats.all_time.calls === 0 && <div className="rounded-2xl bg-[var(--bg-code)] p-5"><Sparkles size={22} className="mb-3 text-[var(--accent)]" /><h3 className="font-medium text-[var(--text-primary)]">Your first insights are on the way</h3><p className="mt-2 text-xs leading-relaxed text-[var(--text-muted)]">Send a message to start tracking tokens, reasoning and cache savings. Only calls recorded since usage tracking was enabled appear here.</p></div>}
      <Overview period={period} />
      {(period.unpriced_calls > 0 || period.unreported_calls > 0 || period.reserved_usd > 0) && <div className="rounded-xl bg-[var(--accent-soft)] p-3 text-xs leading-relaxed text-[var(--accent-amber)]"><p className="font-medium">Some costs are incomplete</p><p className="mt-1">{period.unpriced_calls} unpriced calls · {period.unreported_calls} calls without reported usage.</p>{period.reserved_usd > 0 && <p className="mt-1">Pending / unknown upper estimate: {usd(period.reserved_usd)}. Not added to the cost above.</p>}</div>}
      <TokenMix period={period} />
      {breakdown?.by_conversation && <section className="rounded-2xl bg-[var(--bg-code)] p-5">
        <h3 className="text-sm font-medium text-[var(--text-primary)]">Prompt caching</h3>
        <p className="mt-1 text-xs text-[var(--text-muted)]">Provider-reported cached input · {breakdownNote}</p>
        {!breakdown.by_conversation.some(scope => ['main', 'thread'].includes(scope.conversation_kind || '')) && <p className="mt-4 text-xs text-[var(--text-muted)]">Conversation requests appear here once usage is recorded.</p>}
        <div className="mt-4 space-y-4">{breakdown.by_conversation.filter(scope => ['main', 'thread'].includes(scope.conversation_kind || '')).map(scope => <div key={scope.conversation_kind}>
          <div className="flex justify-between text-xs"><span>{scope.conversation_kind === 'main' ? 'Main timeline' : 'Side threads'}</span><span className="font-mono text-[var(--accent)]">{scope.cache_reported ? percent(scope.cache_hit_rate) : 'Not reported'}</span></div>
          <div className="mt-2 h-1.5 rounded-full bg-[var(--bg-pill)]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.min(100, scope.cache_hit_rate * 100)}%` }} /></div>
          <p className="mt-2 text-[11px] text-[var(--text-muted)]">{count(scope.cached_tokens)} cached tokens · {usd(scope.cache_savings_usd)} saved · {scope.cache_reported}/{scope.calls} calls report cache usage</p>
        </div>)}</div>
      </section>}
      <DailyChart days={stats.daily || []} />
      {breakdown && <ActivityBreakdown breakdown={breakdown} note={breakdownNote} />}
      <PricingEditor key={JSON.stringify(stats.settings.prices)} rates={stats.settings.prices} busy={busy} error={pricingError} onSave={rates => void request(rates)} onDirty={next => { setDirty(next); setSaved(false); setPricingError(null); }} />
      {dirty && <p className="text-xs text-[var(--accent-amber)]">Unsaved pricing edits · save or discard them to refresh.</p>}
      {saved && <p role="status" className="flex items-center gap-2 text-xs text-[var(--accent-emerald)]"><Check size={14} />Rates saved. Future calls use these prices.</p>}
      <details className="rounded-xl bg-[var(--bg-code)] p-4 text-xs text-[var(--text-muted)]"><summary className="cursor-pointer text-[var(--text-secondary)]">What is included?</summary><p className="mt-3 leading-relaxed">{stats.coverage}</p></details>
    </>}
  </div>;
}
