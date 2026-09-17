import { useState } from 'react';
import type { FC } from 'react';
import { Search, X } from 'lucide-react';
import type { SearchResult } from '../types';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSession: (id: string) => void;
  onSearch: (query: string) => Promise<SearchResult[]>;
}

export const SearchModal: FC<SearchModalProps> = ({
  isOpen,
  onClose,
  onSelectSession,
  onSearch,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  if (!isOpen) return null;

  const handleSearchChange = async (val: string) => {
    setQuery(val);
    if (!val.trim()) {
      setResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    try {
      const res = await onSearch(val);
      setResults(res);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/60 backdrop-blur-sm p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl bg-[var(--bg-modal)] p-4 text-[var(--text-primary)] shadow-2xl flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-[var(--bg-modal-inner)]">
          <Search className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" />
          <input
            type="text"
            placeholder="Search conversations & messages..."
            value={query}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full text-sm font-medium bg-transparent text-[var(--text-primary)] placeholder-[var(--text-dim)] outline-none"
            autoFocus
          />
          {query ? (
            <button
              type="button"
              onClick={() => handleSearchChange('')}
              className="text-[var(--text-dim)] hover:text-[var(--text-primary)] p-0.5"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            <span className="text-[10px] font-mono text-[var(--text-dim)]">ESC</span>
          )}
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto space-y-1">
          {isSearching ? (
            <p className="text-xs text-[var(--text-dim)] py-6 text-center font-mono">Searching...</p>
          ) : results.length > 0 ? (
            results.map((res) => (
              <div
                key={res.message_id}
                onClick={() => {
                  onSelectSession(res.session_id);
                  onClose();
                  setQuery('');
                  setResults([]);
                }}
                className="p-3 rounded-xl hover:bg-[var(--bg-card-hover)] cursor-pointer transition-colors"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-[var(--text-primary)] truncate">{res.session_name || 'Conversation'}</p>
                  <span className="text-[10px] font-mono text-[var(--text-dim)] uppercase">{res.role}</span>
                </div>
                <p
                  className="text-xs text-[var(--text-muted)] mt-1 line-clamp-2"
                  dangerouslySetInnerHTML={{ __html: res.snippet || res.content }}
                />
              </div>
            ))
          ) : query.trim() ? (
            <p className="text-xs text-[var(--text-dim)] py-6 text-center">No results found for "{query}"</p>
          ) : (
            <p className="text-xs text-[var(--text-dim)] py-6 text-center">Type to search through all past conversations...</p>
          )}
        </div>
      </div>
    </div>
  );
};
