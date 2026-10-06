import { useEffect, useRef, useState } from 'react';
import { FileText, MessageSquare, Search, X } from 'lucide-react';
import * as api from '../api';
import type { Artifact } from '../types';

export function HighlightedExcerpt({ text }: { text: string }) {
  return <>{text.split(/(\uE000[^\uE001]*\uE001)/g).map((part, index) => part.startsWith('\uE000') ? <mark key={index} className="rounded bg-[var(--accent-soft)] text-[var(--accent)]">{part.slice(1, -1)}</mark> : part)}</>;
}

export function RepositorySearch({ currentSessionId, onSelectMessage, onSelectSession, onOpenArtifact, onClose }: {
  currentSessionId: string | null; onSelectMessage: (sessionId: string, messageId: string) => void;
  onSelectSession: (sessionId: string) => void; onOpenArtifact?: (artifact: Artifact) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [scope, setScope] = useState('all');
  const [role, setRole] = useState('');
  const [after, setAfter] = useState('');
  const [before, setBefore] = useState('');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<api.RepositorySearchPage>({ results: [], has_more: false, next_offset: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const reset = (update: () => void) => { generation.current += 1; setBusy(false); setError(''); setOffset(0); setPage({ results: [], has_more: false, next_offset: null }); update(); };
  useEffect(() => {
    const controller = new AbortController();
    const requestGeneration = ++generation.current;
    if (!query.trim()) return;
    const timer = window.setTimeout(async () => {
      setBusy(true);
      try {
        const filters: Record<string, string> = { kind, offset: String(offset) };
        if (scope === 'current' && currentSessionId) filters.session_id = currentSessionId;
        if (role) filters.role = role;
        if (after) filters.after = after;
        if (before) filters.before = before;
        const result = await api.searchRepository(query.trim(), filters, controller.signal);
        if (requestGeneration !== generation.current) return;
        setPage(previous => ({ ...result, results: offset ? Array.from(new Map([...previous.results, ...result.results].map(item => [item.kind + ':' + item.id, item])).values()) : result.results }));
        setError('');
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Search failed');
      } finally {
        if (requestGeneration === generation.current) setBusy(false);
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, kind, scope, role, after, before, offset, currentSessionId]);
  return <div className="flex h-full flex-col">
    <div className="flex items-center justify-between px-4 py-3"><h3 className="flex items-center gap-2 text-sm font-semibold"><Search size={16} />Search</h3><button aria-label="Close search" onClick={onClose}><X size={16} /></button></div>
    <div className="space-y-3 px-3 pb-3">
      <input autoFocus aria-label="Search saved content" placeholder='Search… use "exact phrases"' value={query} onChange={event => reset(() => setQuery(event.target.value))} className="w-full rounded-xl bg-[var(--bg-card)] px-3 py-2.5 text-xs outline-none" />
      <div className="flex flex-wrap gap-1">{['all', 'messages', 'threads', 'documents'].map(category => <button key={category} aria-pressed={kind === category} onClick={() => reset(() => setKind(category))} className={`rounded-lg px-2 py-1.5 text-[11px] capitalize ${kind === category ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>{category}</button>)}</div>
      <details className="text-xs text-[var(--text-muted)]"><summary className="cursor-pointer">Filters</summary><div className="mt-2 grid gap-2">
        <select aria-label="Search scope" value={scope} onChange={event => reset(() => setScope(event.target.value))} className="rounded-lg bg-[var(--bg-card)] p-2"><option value="all">All conversations</option><option value="current">Current conversation</option></select>
        <select aria-label="Message author" value={role} onChange={event => reset(() => setRole(event.target.value))} className="rounded-lg bg-[var(--bg-card)] p-2"><option value="">Any author</option><option value="user">My messages</option><option value="assistant">Velocity responses</option></select>
        <label>From<input type="date" value={after} onChange={event => reset(() => setAfter(event.target.value))} className="ml-2 rounded-lg bg-[var(--bg-card)] p-2" /></label>
        <label>Until<input type="date" value={before} onChange={event => reset(() => setBefore(event.target.value))} className="ml-2 rounded-lg bg-[var(--bg-card)] p-2" /></label>
      </div></details>
    </div>
    <div className="flex-1 overflow-y-auto px-2 pb-4">
      {error && <p role="alert" className="p-3 text-xs text-[var(--accent)]">{error}</p>}
      {!busy && !error && !page.results.length && <p className="p-5 text-center text-xs text-[var(--text-muted)]">{query.trim() ? 'No matches. Try fewer words or wider filters.' : 'Find messages, threads and documents.'}</p>}
      {['documents', 'messages', 'threads'].map(category => {
        const results = page.results.filter(result => result.kind === category);
        return results.length ? <section key={category}><h4 className="px-3 pb-2 pt-4 text-[10px] uppercase tracking-wider text-[var(--text-dim)]">{category} · {results.length}</h4>{results.map(result => <button key={result.id} className="mb-1 w-full rounded-xl px-3 py-3 text-left hover:bg-[var(--bg-card)]" onClick={async () => {
          try {
            if (result.kind === 'documents') onOpenArtifact?.(await api.getArtifact(result.id));
            else if (result.message_id) onSelectMessage(result.session_id, result.message_id);
            else onSelectSession(result.session_id);
            onClose();
          } catch { setError('Could not open this result. It may have been deleted.'); }
        }}><div className="flex items-center gap-2 text-xs font-medium">{category === 'documents' ? <FileText size={14} className="shrink-0 text-[var(--text-muted)]" /> : <MessageSquare size={14} className="shrink-0 text-[var(--text-muted)]" />}<span className="truncate">{result.title || 'Main timeline'}</span></div><p className="mt-1 line-clamp-3 text-xs leading-relaxed text-[var(--text-muted)]"><HighlightedExcerpt text={result.snippet || result.content} /></p><p className="mt-1 text-[10px] text-[var(--text-dim)]">{result.role ? result.role === 'user' ? 'You · ' : 'Velocity · ' : ''}{new Date(result.created_at).toLocaleDateString()}</p></button>)}</section> : null;
      })}
      {busy && <p role="status" className="p-4 text-center text-xs text-[var(--text-muted)]">Searching…</p>}
      {page.has_more && !busy && <button onClick={() => setOffset(page.next_offset || 0)} className="mt-3 w-full rounded-xl bg-[var(--bg-card)] p-3 text-xs">Load more results</button>}
    </div>
  </div>;
}
