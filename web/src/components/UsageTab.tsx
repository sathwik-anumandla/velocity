import { useEffect, useState } from 'react';

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

interface UsageStats {
  settings: { prices: Record<string, { input: number; cached_input: number; output: number }> };
  today: UsagePeriod;
  month: UsagePeriod;
  all_time: UsagePeriod;
  by_model: UsagePeriod[];
  by_source: UsagePeriod[];
  coverage: string;
}

const usd = (amount: number) => `$${amount.toFixed(6)}`;

function PeriodCard({ title, period }: { title: string; period: UsagePeriod }) {
  return <section className="rounded-xl border border-neutral-800 bg-[#141418] p-4 space-y-2">
    <h3 className="text-sm font-semibold text-white">{title}</h3>
    <p>{usd(period.cost_usd)} estimated · {period.calls} API calls</p>
    <p>Input: {period.input_tokens.toLocaleString()} · Output: {period.output_tokens.toLocaleString()}</p>
    <p>{period.reasoning_reported > 0 ? `Reasoning: ${period.reasoning_tokens.toLocaleString()} tokens · ${(period.reasoning_share * 100).toFixed(1)}% of reporting calls’ output` : 'Reasoning: provider data unavailable'} (included in output; reported by {period.reasoning_reported} calls)</p>
    <p>Cache reads: {period.cached_tokens.toLocaleString()} · Writes: {period.cache_write_tokens.toLocaleString()}</p>
    <p>{period.cache_reported > 0 ? `Cache hit rate: ${(period.cache_hit_rate * 100).toFixed(1)}% of reported input` : 'Cache hit rate: provider data unavailable'} · {period.cache_reported} reporting calls</p>
    <p>Cache hits: {period.cache_hit_calls} calls · Estimated savings: {usd(period.cache_savings_usd)}</p>
    {period.reserved_usd > 0 && <p>Pending / unknown upper estimate: {usd(period.reserved_usd)}</p>}
    {(period.unpriced_calls > 0 || period.unreported_calls > 0) && <p className="text-amber-300">Unpriced: {period.unpriced_calls} · Usage unavailable: {period.unreported_calls}</p>}
  </section>;
}

export function UsageTab() {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [prices, setPrices] = useState('{}');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  const load = async (pricing?: object) => {
    try {
      const response = await fetch(pricing ? '/api/usage/prices' : '/api/usage', pricing ? {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pricing),
      } : undefined);
      if (!response.ok) throw new Error(`Usage request failed (HTTP ${response.status}): ${await response.text()}`);
      const value: UsageStats = await response.json();
      setStats(value);
      setPrices(JSON.stringify(value.settings.prices, null, 2));
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Usage unavailable');
    } finally { setBusy(false); }
  };

  useEffect(() => { void load(); }, []);

  return <div className="space-y-4 text-xs text-neutral-300">
    <div className="flex items-center justify-between">
      <p>USD estimates · UTC periods · tracked since this upgrade</p>
      <button disabled={busy} onClick={() => { setBusy(true); void load(); }} className="rounded-lg bg-neutral-800 px-3 py-2 disabled:opacity-50">{busy ? 'Loading…' : 'Refresh'}</button>
    </div>
    {error && <p role="alert" className="text-red-400">{error}</p>}
    {stats && <>
      <PeriodCard title="Today" period={stats.today} />
      <PeriodCard title="This month" period={stats.month} />
      <PeriodCard title="All time" period={stats.all_time} />
      <form className="space-y-3" onSubmit={(event) => {
        event.preventDefault();
        try {
          const pricing = JSON.parse(prices);
          setBusy(true);
          void load({ prices: pricing });
        } catch (failure) { setError(failure instanceof Error ? failure.message : 'Invalid prices'); }
      }}>
        <details><summary className="cursor-pointer">Model prices / custom provider</summary>
          <p className="py-2">USD per million tokens: input, cached_input, output. Configure actual provider rates to estimate costs. No spending limits are enforced.</p>
          <textarea aria-label="Model prices JSON" rows={8} value={prices} onChange={(event) => setPrices(event.target.value)} className="w-full rounded bg-neutral-800 p-3 font-mono" />
          <button disabled={busy} className="rounded-lg bg-sky-700 px-4 py-2 disabled:opacity-50">Save prices</button>
        </details>
      </form>
      <h3 className="text-sm font-semibold text-white">By model · all time</h3>
      {stats.by_model.map((period) => <PeriodCard key={period.model} title={period.model || 'Unknown model'} period={period} />)}
      <h3 className="text-sm font-semibold text-white">By activity · all time</h3>
      {stats.by_source.map((period) => <p key={period.source}>{period.source}: {period.calls} calls · {usd(period.cost_usd)}</p>)}
      <p className="text-neutral-500">{stats.coverage}</p>
    </>}
  </div>;
}
