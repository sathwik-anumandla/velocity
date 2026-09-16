import { useState, useEffect, useRef } from 'react';
import type { FC } from 'react';
import type { ThinkingEffort, RecallBudget, Verbosity } from '../types';

interface OptionsMenuProps {
  isOpen: boolean;
  onClose: () => void;
  thinkingEffort: ThinkingEffort;
  recallBudget: RecallBudget;
  verbosity: Verbosity;
  onUpdateEffort: (effort: ThinkingEffort) => void;
  onUpdateRecall: (budget: RecallBudget) => void;
  onUpdateVerbosity: (verbosity: Verbosity) => void;
}

export const OptionsMenu: FC<OptionsMenuProps> = ({
  isOpen,
  onClose,
  thinkingEffort,
  recallBudget,
  verbosity,
  onUpdateEffort,
  onUpdateRecall,
  onUpdateVerbosity,
}) => {
  const [activeSubMenu, setActiveSubMenu] = useState<'effort' | 'recall' | 'verbosity' | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Click-outside listener
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      // If click target is inside popover or the '+' button, don't close here (handled by toggle)
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        const plusButton = document.getElementById('options-toggle-btn');
        if (plusButton && plusButton.contains(event.target as Node)) {
          return;
        }
        onClose();
        setActiveSubMenu(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const getEffortDescription = (effort: ThinkingEffort) => {
    switch (effort) {
      case 'none':
        return 'No reasoning effort. Fastest, lowest latency responses.';
      case 'low':
        return 'Minimal reasoning for faster, direct responses.';
      case 'medium':
        return 'Balanced reasoning for general tasks (default).';
      case 'high':
        return 'Deep reasoning effort for complex logic and coding.';
      case 'xhigh':
        return 'Extra high reasoning for complex architecture and analysis.';
      case 'max':
        return 'Maximum reasoning depth for the hardest reasoning problems.';
    }
  };

  const getRecallDescription = (recall: RecallBudget) => {
    switch (recall) {
      case 'low':
        return 'Focuses on immediate context with fast recall.';
      case 'medium':
        return 'Standard memory recall from Hindsight (default).';
      case 'high':
        return 'Deep memory recall across all past conversations.';
    }
  };

  const getVerbosityDescription = (v: Verbosity) => {
    switch (v) {
      case 'low':
        return 'Concise, direct, and punchy responses in natural paragraphs (default).';
      case 'medium':
        return 'Balanced detail and standard explanations in clear prose.';
      case 'high':
        return 'Thorough, exhaustive explanations, edge cases, and complete code.';
    }
  };

  return (
    <div
      ref={popoverRef}
      className="absolute bottom-full left-0 mb-3 w-72 rounded-2xl bg-[#1E1E22] border border-[#2E2E34] shadow-2xl shadow-black/80 backdrop-blur-xl p-3 z-50 text-white select-none animate-fade-in"
    >
      {activeSubMenu === null ? (
        // Main Menu: Pure typography, NO icons
        <div className="flex flex-col space-y-1">
          <button
            type="button"
            onClick={() => setActiveSubMenu('effort')}
            className="flex items-center justify-between w-full px-3 py-2.5 rounded-xl hover:bg-[#2C2C32] transition-colors text-left group"
          >
            <span className="text-[13.5px] font-medium text-white group-hover:text-white">effort</span>
            <span className="text-xs font-mono font-medium text-zinc-400 capitalize">{thinkingEffort}</span>
          </button>

          <div className="h-[1px] bg-[#27272A] mx-2" />

          <button
            type="button"
            onClick={() => setActiveSubMenu('recall')}
            className="flex items-center justify-between w-full px-3 py-2.5 rounded-xl hover:bg-[#2C2C32] transition-colors text-left group"
          >
            <span className="text-[13.5px] font-medium text-white group-hover:text-white">recall</span>
            <span className="text-xs font-mono font-medium text-zinc-400 capitalize">{recallBudget}</span>
          </button>

          <div className="h-[1px] bg-[#27272A] mx-2" />

          <button
            type="button"
            onClick={() => setActiveSubMenu('verbosity')}
            className="flex items-center justify-between w-full px-3 py-2.5 rounded-xl hover:bg-[#2C2C32] transition-colors text-left group"
          >
            <span className="text-[13.5px] font-medium text-white group-hover:text-white">verbosity</span>
            <span className="text-xs font-mono font-medium text-zinc-400 capitalize">{verbosity}</span>
          </button>
        </div>
      ) : (
        // Submenu: Clean Typography, NO header icons
        <div className="flex flex-col">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#27272A]">
            <button
              type="button"
              onClick={() => setActiveSubMenu(null)}
              className="text-xs font-medium text-zinc-400 hover:text-white px-1.5 py-1 rounded transition-colors"
            >
              Back
            </button>
            <span className="text-[13px] font-semibold text-white capitalize">{activeSubMenu}</span>
            <span className="text-[11px] font-mono font-bold text-zinc-300 uppercase">
              {activeSubMenu === 'effort' ? thinkingEffort : activeSubMenu === 'recall' ? recallBudget : verbosity}
            </span>
          </div>

          {/* Effort Options: 2 Rows of 3 */}
          {activeSubMenu === 'effort' && (
            <div className="flex flex-col space-y-1.5 bg-[#141417] p-1 rounded-xl">
              <div className="grid grid-cols-3 gap-1">
                {(['none', 'low', 'medium'] as ThinkingEffort[]).map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => onUpdateEffort(level)}
                    className={`py-1.5 text-xs font-medium rounded-lg transition-all capitalize ${
                      thinkingEffort === level
                        ? 'bg-[#2C2C32] text-white font-semibold shadow-sm'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {level === 'medium' ? 'Med' : level}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-1">
                {(['high', 'xhigh', 'max'] as ThinkingEffort[]).map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => onUpdateEffort(level)}
                    className={`py-1.5 text-xs font-medium rounded-lg transition-all capitalize ${
                      thinkingEffort === level
                        ? 'bg-[#2C2C32] text-white font-semibold shadow-sm'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {level === 'xhigh' ? 'XHigh' : level}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Recall Options */}
          {activeSubMenu === 'recall' && (
            <div className="grid grid-cols-3 gap-1 bg-[#141417] p-1 rounded-xl">
              {(['low', 'medium', 'high'] as RecallBudget[]).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => onUpdateRecall(level)}
                  className={`py-1.5 text-xs font-medium rounded-lg transition-all capitalize ${
                    recallBudget === level
                      ? 'bg-[#2C2C32] text-white font-semibold shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {level === 'medium' ? 'Med' : level}
                </button>
              ))}
            </div>
          )}

          {/* Verbosity Options */}
          {activeSubMenu === 'verbosity' && (
            <div className="grid grid-cols-3 gap-1 bg-[#141417] p-1 rounded-xl">
              {(['low', 'medium', 'high'] as Verbosity[]).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => onUpdateVerbosity(level)}
                  className={`py-1.5 text-xs font-medium rounded-lg transition-all capitalize ${
                    verbosity === level
                      ? 'bg-[#2C2C32] text-white font-semibold shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {level === 'medium' ? 'Med' : level}
                </button>
              ))}
            </div>
          )}

          <p className="mt-2.5 px-1 text-[11.5px] leading-relaxed text-zinc-400 font-sans">
            {activeSubMenu === 'effort'
              ? getEffortDescription(thinkingEffort)
              : activeSubMenu === 'recall'
              ? getRecallDescription(recallBudget)
              : getVerbosityDescription(verbosity)}
          </p>
        </div>
      )}
    </div>
  );
};
