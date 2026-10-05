import { useEffect, useState } from 'react';
import { Activity, ArrowLeft, ArrowRight, ArrowDownToLine, Brain, Check, ChevronDown, Coins, RefreshCw, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';

interface UsagePeriod {
  model?: string;
  source?: string;
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
interface Breakdown { by_model: UsagePeriod[]; by_source: UsagePeriod[] }

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
const compact = (value: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const usd = (value: number) => `$${value.toFixed(value === 0 || value >= 1 ? 2 : value >= 0.01 ? 4 : 6)}`;
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const dateLabel = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const sourceLabel = (source: string) => ({ chat: 'Conversations', scheduled: 'Scheduled routines', title: 'Chat titles', summary: 'Context summaries', rollup: 'Thread summaries', synthesis: 'Memory synthesis' }[source] || source.replaceAll('_', ' '));

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return <section className="rounded-2xl bg-[#0d0d0f] p-4 sm:p-5 space-y-4">
    <div><h3 className="text-sm font-semibold text-white">{title}</h3>{note && <p className="mt-1 text-xs text-neutral-400">{note}</p>}</div>
    {children}
  </section>;
}

function Stat({ label, value, hint, icon }: { label: string; value: string; hint: string; icon: ReactNode }) {
  return <div className="min-w-0 rounded-2xl bg-[#0d0d0f] p-4">
    <div className="flex items-center gap-2 text-neutral-400">{icon}<span className="text-xs">{label}</span></div>
    <p className="mt-3 text-2xl font-semibold tracking-tight text-white tabular-nums break-all">{value}</p>
    <p className="mt-1 text-xs text-neutral-400">{hint}</p>
  </div>;
}

function Insight({ label, value, available, detail, color, icon }: { label: string; value: number; available: boolean; detail: string; color: string; icon: ReactNode }) {
  return <div className="min-w-0 space-y-3 rounded-2xl bg-[#0d0d0f] p-4">
    <div className="flex items-center gap-2 text-neutral-300">{icon}<h3 className="text-sm font-medium">{label}</h3></div>
    <p className="text-2xl font-semibold text-white tabular-nums">{available ? percent(value) : '—'}</p>
    <div role="img" aria-label={available ? `${label}: ${percent(value)}` : `${label}: provider data unavailable`} className="h-2 rounded-full bg-neutral-800 overflow-hidden">
      {available && <div className="h-full rounded-full" style={{ width: percent(Math.min(1, Math.max(0, value))), background: color }} />}
    </div>
    <p className="text-xs leading-relaxed text-neutral-400">{detail}</p>
  </div>;
}

function TokenMix({ period }: { period: UsagePeriod }) {
  const total = period.input_tokens + period.output_tokens;
  const share = total ? period.input_tokens / total : 0;
  return <Panel title="Token breakdown" note="Input + output = total tokens. Reasoning is already included in output.">
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative h-32 w-32 shrink-0">
        <svg viewBox="0 0 120 120" role="img" aria-label={`${count(period.input_tokens)} input tokens and ${count(period.output_tokens)} output tokens`} className="h-full w-full">
          <circle cx="60" cy="60" r="50" fill="none" stroke={total ? '#818cf8' : '#27272a'} strokeWidth="9" />
          <circle cx="60" cy="60" r="50" fill="none" stroke="#e4e4e7" strokeWidth="9" pathLength="100" strokeDasharray={`${share * 100} 100`} transform="rotate(-90 60 60)" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center" aria-hidden="true"><span className="text-xl font-semibold text-white tabular-nums">{compact(total)}</span><span className="text-[11px] text-neutral-400">total tokens</span></div>
      </div>
      <dl className="min-w-0 flex-1 space-y-3 text-xs">
        <div className="flex justify-between gap-3"><dt className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-neutral-200" />Input</dt><dd className="text-white tabular-nums">{count(period.input_tokens)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-indigo-400" />Output</dt><dd className="text-white tabular-nums">{count(period.output_tokens)}</dd></div>
        <div className="pt-2 text-neutral-400 space-y-1"><p>Cached input: {period.cache_reported ? count(period.cached_tokens) : 'not reported'}</p><p>Cache writes: {period.cache_reported ? count(period.cache_write_tokens) : 'not reported'}</p><p>Reasoning: {period.reasoning_reported ? count(period.reasoning_tokens) : 'not reported'}</p></div>
      </dl>
    </div>
  </Panel>;
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
      <div className="flex rounded-lg bg-neutral-900 p-1" role="group" aria-label="Chart metric">
        {(['tokens', 'cost', 'calls'] as Metric[]).map(option => <button key={option} aria-pressed={metric === option} onClick={() => setMetric(option)} className={`rounded-md px-3 py-2 text-xs capitalize ${metric === option ? 'bg-neutral-700 text-white' : 'text-neutral-400 hover:text-white'}`}>{option}</button>)}
      </div>
      <span className="text-[11px] text-neutral-400">Peak: {display(maximum)}</span>
    </div>
    {!day ? <p className="py-6 text-center text-neutral-400">Update the backend to enable daily history.</p> : <>
      <div className="relative">
        <div aria-hidden="true" className="absolute inset-x-0 top-0 bottom-0 flex flex-col justify-between"><div className="border-t border-neutral-800" /><div className="border-t border-neutral-800" /><div className="border-t border-neutral-800" /></div>
        <div className="relative flex h-32 items-end gap-1" role="group" aria-label={`Daily ${metric}. Choose a day for details.`}>
          {days.map(entry => <button key={entry.date} aria-pressed={day.date === entry.date} aria-label={`${dateLabel(entry.date)}: ${display(value(entry))} ${metric === 'cost' ? 'USD estimated' : metric}`} title={`${dateLabel(entry.date)} · ${display(value(entry))}`} onClick={() => setSelected(entry.date)} className="group flex h-full min-w-0 flex-1 items-end rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
            <span className={`w-full rounded-t-sm ${entry.date === day.date ? 'bg-indigo-400' : 'bg-neutral-600 group-hover:bg-neutral-400'}`} style={{ height: `${maximum ? Math.max(2, value(entry) / maximum * 100) : 2}%` }} />
          </button>)}
        </div>
      </div>
      <div className="flex justify-between text-[11px] text-neutral-500"><span>{dateLabel(days[0].date)}</span><span>{dateLabel(days[days.length - 1].date)}</span></div>
      <div className="flex items-center gap-3 rounded-xl bg-neutral-900 p-3">
        <button aria-label="Previous day" disabled={selectedIndex === 0} onClick={() => setSelected(days[selectedIndex - 1].date)} className="p-2 rounded-lg text-neutral-400 hover:bg-neutral-800 disabled:opacity-30"><ArrowLeft size={16} /></button>
        <div className="min-w-0 flex-1 text-center" aria-live="polite"><p className="text-xs text-white">{dateLabel(day.date)} · {display(value(day))} {metric === 'cost' ? 'estimated' : metric}</p><p className="mt-1 text-[11px] text-neutral-400">{count(day.calls)} calls{day.unpriced_calls > 0 ? ` · ${day.unpriced_calls} unpriced` : ''}{day.unreported_calls > 0 ? ` · ${day.unreported_calls} missing usage` : ''}</p></div>
        <button aria-label="Next day" disabled={selectedIndex === days.length - 1} onClick={() => setSelected(days[selectedIndex + 1].date)} className="p-2 rounded-lg text-neutral-400 hover:bg-neutral-800 disabled:opacity-30"><ArrowRight size={16} /></button>
      </div>
      {!maximum && <p className="text-xs text-neutral-400">{metric === 'cost' ? 'No priced spending recorded in this window. Unpriced calls are not free calls.' : 'No tracked activity for this metric in this window.'}</p>}
    </>}
  </Panel>;
}

function BreakdownChart({ title, rows, field, note }: { title: string; rows: UsagePeriod[]; field: 'model' | 'source'; note: string }) {
  const [metric, setMetric] = useState<'cost' | 'calls'>('calls');
  const sorted = [...rows].sort((first, second) => metric === 'cost' ? second.cost_usd - first.cost_usd : second.calls - first.calls);
  const maximum = Math.max(...rows.map(row => metric === 'cost' ? row.cost_usd : row.calls), 0);
  return <Panel title={title} note={note}>
    <div className="flex gap-2" role="group" aria-label={`${title} metric`}>
      {(['calls', 'cost'] as const).map(option => <button key={option} aria-pressed={metric === option} onClick={() => setMetric(option)} className={`rounded-lg px-3 py-2 text-xs capitalize ${metric === option ? 'bg-neutral-700 text-white' : 'bg-neutral-900 text-neutral-400'}`}>{option}</button>)}
    </div>
    {sorted.length === 0 && <p className="py-3 text-neutral-400">No tracked calls in this period.</p>}
    <ul className="space-y-4">{sorted.map(row => {
      const amount = metric === 'cost' ? row.cost_usd : row.calls;
      const label = field === 'source' ? sourceLabel(row.source || 'Unknown') : row.model || 'Unknown model';
      return <li key={row[field]} className="space-y-2">
        <div className="flex items-baseline justify-between gap-3 text-xs"><span className="min-w-0 break-all text-neutral-200">{label}</span><span className="shrink-0 text-white tabular-nums">{metric === 'cost' ? usd(amount) : `${count(amount)} calls`}</span></div>
        <div role="img" aria-label={`${label}: ${metric === 'cost' ? usd(amount) : count(amount)} ${metric}`} className="h-1.5 overflow-hidden rounded-full bg-neutral-800"><div className="h-full rounded-full bg-neutral-400" style={{ width: `${maximum ? amount / maximum * 100 : 0}%` }} /></div>
        {row.unpriced_calls > 0 && <p className="text-[11px] text-amber-300">{row.unpriced_calls} calls have no configured price</p>}
      </li>;
    })}</ul>
  </Panel>;
}

function PricingEditor({ rates, busy, error, onSave, onDirty }: { rates: Rates; busy: boolean; error: string | null; onSave: (rates: Rates) => void; onDirty: (dirty: boolean) => void }) {
  const initial = () => Object.fromEntries(Object.entries(rates).map(([name, rate]) => [name, { input: String(rate.input), cached_input: String(rate.cached_input), output: String(rate.output) }]));
  const [draft, setDraft] = useState(initial);
  const [name, setName] = useState('');
  const [validation, setValidation] = useState<string | null>(null);
  return <details className="rounded-2xl bg-[#0d0d0f] p-4 group">
    <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-white">Model pricing <ChevronDown size={16} className="text-neutral-400 group-open:rotate-180" /></summary>
    <p className="mt-3 text-xs leading-relaxed text-neutral-400">Optional provider rates in USD per million tokens. Changes affect future calls, not past estimates. Reset/remove restores a default rate when available. No spending limits are enforced.</p>
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
      {Object.entries(draft).map(([model, rate]) => <fieldset key={model} className="min-w-0 rounded-xl bg-neutral-900 p-3">
        <legend className="px-1 text-xs text-neutral-200 break-all">{model}</legend>
        <button type="button" disabled={busy} aria-label={`Reset or remove ${model} price`} onClick={() => { setDraft(Object.fromEntries(Object.entries(draft).filter(([key]) => key !== model))); onDirty(true); }} className="mb-2 rounded-lg py-1 text-[11px] text-neutral-400 hover:text-white">Reset/remove rate</button>
        <div className="grid grid-cols-3 gap-2">{(['input', 'cached_input', 'output'] as const).map(field => <label key={field} className="min-w-0 text-[11px] text-neutral-400">{field === 'cached_input' ? 'Cached input' : field === 'input' ? 'Input' : 'Output'}<input aria-label={`${model} ${field} price`} type="number" min="0" step="any" required disabled={busy} value={rate[field]} onChange={event => { setDraft({ ...draft, [model]: { ...rate, [field]: event.target.value } }); onDirty(true); }} className="mt-1 w-full rounded-lg bg-[#0d0d0f] p-2 text-white tabular-nums focus:outline-none focus:ring-1 focus:ring-neutral-500" /></label>)}</div>
      </fieldset>)}
      <div className="flex flex-wrap gap-2"><input aria-label="New model name" placeholder="Custom model ID" value={name} onChange={event => setName(event.target.value)} className="min-w-0 flex-1 rounded-lg bg-neutral-900 p-2 text-xs text-white" /><button type="button" disabled={busy || !name.trim() || name.trim() in draft} onClick={() => { setDraft({ ...draft, [name.trim()]: { input: '', cached_input: '', output: '' } }); setName(''); onDirty(true); }} className="rounded-lg bg-neutral-800 px-3 py-2 text-xs disabled:opacity-40">Add model</button></div>
      {validation && <p role="alert" className="text-xs text-red-400">{validation}</p>}
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2"><button disabled={busy} className="rounded-lg bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-40">Save rates</button><button disabled={busy} type="button" onClick={() => { setDraft(initial()); setValidation(null); onDirty(false); }} className="rounded-lg px-3 py-2 text-xs text-neutral-400">Discard edits</button></div>
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

  return <div className="space-y-4 text-neutral-300 select-text" aria-busy={busy}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-sm font-medium text-white">Your AI activity, at a glance</p><p className="mt-1 text-xs text-neutral-400">USD estimates · periods use UTC{updated ? ` · updated ${updated}` : ''}</p></div>
      <button disabled={busy || dirty} title={dirty ? 'Save or discard pricing edits before refreshing' : 'Refresh usage'} onClick={() => void request()} className="flex items-center gap-2 rounded-xl bg-neutral-800 px-3 py-2 text-xs text-white disabled:opacity-40"><RefreshCw size={14} className={busy ? 'motion-safe:animate-spin' : ''} />{busy ? 'Loading' : 'Refresh'}</button>
    </div>
    <div className="flex rounded-xl bg-[#0d0d0f] p-1" role="group" aria-label="Usage overview period">{ranges.map(option => <button key={option.id} aria-pressed={range === option.id} onClick={() => setRange(option.id)} className={`flex-1 rounded-lg px-2 py-2.5 text-xs font-medium ${range === option.id ? 'bg-neutral-700 text-white' : 'text-neutral-400 hover:text-white'}`}>{option.label}</button>)}</div>
    {error && <div role="alert" className="rounded-xl bg-red-950/30 p-3 text-xs text-red-300">{stats ? 'Refresh failed. Showing the last loaded data. ' : ''}{error}{!stats && <button onClick={() => void request()} disabled={busy} className="ml-2 underline">Try again</button>}</div>}
    {busy && !stats && <div className="grid grid-cols-2 gap-3" aria-label="Loading usage">{[0, 1, 2, 3].map(index => <div key={index} className="h-28 rounded-2xl bg-[#0d0d0f] motion-safe:animate-pulse" />)}</div>}
    {stats && period && <>
      {stats.all_time.calls === 0 && <div className="rounded-2xl bg-[#0d0d0f] p-5"><Sparkles size={22} className="mb-3 text-indigo-400" /><h3 className="font-medium text-white">Your first insights are on the way</h3><p className="mt-2 text-xs leading-relaxed text-neutral-400">Send a message to start tracking tokens, reasoning and cache savings. Only calls recorded since usage tracking was enabled appear here.</p></div>}
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Estimated cost" value={period.unpriced_calls > 0 && period.cost_usd === 0 ? 'Unpriced' : usd(period.cost_usd)} hint="Priced model calls only" icon={<Coins size={15} />} />
        <Stat label="Total tokens" value={compact(period.input_tokens + period.output_tokens)} hint={`${count(period.input_tokens + period.output_tokens)} input + output`} icon={<Activity size={15} />} />
        <Stat label="API calls" value={count(period.calls)} hint="Includes model/tool hops" icon={<RefreshCw size={15} />} />
        <Stat label="Cache savings" value={usd(period.cache_savings_usd)} hint="Estimated vs. uncached input" icon={<ArrowDownToLine size={15} />} />
      </div>
      {(period.unpriced_calls > 0 || period.unreported_calls > 0 || period.reserved_usd > 0) && <div className="rounded-xl bg-amber-950/25 p-3 text-xs leading-relaxed text-amber-200"><p className="font-medium">Some costs are incomplete</p><p className="mt-1">{period.unpriced_calls} unpriced calls · {period.unreported_calls} calls without reported usage.</p>{period.reserved_usd > 0 && <p className="mt-1">Pending / unknown upper estimate: {usd(period.reserved_usd)}. Not added to the cost above.</p>}</div>}
      <DailyChart days={stats.daily || []} />
      <TokenMix period={period} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Insight label="Cache effectiveness" value={period.cache_hit_rate} available={period.cache_reported > 0} color="#34d399" icon={<ArrowDownToLine size={16} className="text-emerald-400" />} detail={period.cache_reported ? `${count(period.cached_tokens)} cached input tokens · ${count(period.cache_hit_calls)} cache-hit calls. Rate uses input from ${count(period.cache_reported)} reporting calls.` : 'The provider has not reported cache details for this period.'} />
        <Insight label="Reasoning share" value={period.reasoning_share} available={period.reasoning_reported > 0} color="#a78bfa" icon={<Brain size={16} className="text-violet-400" />} detail={period.reasoning_reported ? `${count(period.reasoning_tokens)} reasoning tokens, already included in output. Share uses output from ${count(period.reasoning_reported)} reporting calls.` : 'The provider has not reported reasoning details for this period.'} />
      </div>
      {breakdown && <><BreakdownChart title="Models" note={breakdownNote} rows={breakdown.by_model} field="model" /><BreakdownChart title="Activity" note={breakdownNote} rows={breakdown.by_source} field="source" /></>}
      <PricingEditor key={JSON.stringify(stats.settings.prices)} rates={stats.settings.prices} busy={busy} error={pricingError} onSave={rates => void request(rates)} onDirty={next => { setDirty(next); setSaved(false); setPricingError(null); }} />
      {dirty && <p className="text-xs text-amber-300">Unsaved pricing edits · save or discard them to refresh.</p>}
      {saved && <p role="status" className="flex items-center gap-2 text-xs text-emerald-400"><Check size={14} />Rates saved. Future calls use these prices.</p>}
      <details className="rounded-xl bg-[#0d0d0f] p-4 text-xs text-neutral-400"><summary className="cursor-pointer text-neutral-300">What is included?</summary><p className="mt-3 leading-relaxed">{stats.coverage}</p></details>
    </>}
  </div>;
}
