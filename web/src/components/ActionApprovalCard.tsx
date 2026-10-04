import { useState } from 'react';
import type { FC } from 'react';
import { Mail, Check, X, Loader2, AlertCircle } from 'lucide-react';
import type { StagedAction } from '../types';

interface ActionApprovalCardProps {
  action: StagedAction;
  onRespond?: (actionId: string, decision: 'confirm' | 'decline') => void | Promise<void>;
}

export const ActionApprovalCard: FC<ActionApprovalCardProps> = ({ action, onRespond }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleDecision = async (decision: 'confirm' | 'decline') => {
    if (isSubmitting || !onRespond) return;
    setIsSubmitting(true);
    try {
      await onRespond(action.id, decision);
    } finally {
      setIsSubmitting(false);
    }
  };

  const to = action.parameters?.to || 'Unknown Recipient';
  const subject = action.parameters?.subject || '(No Subject)';
  const body = action.parameters?.body || '';

  return (
    <div className="w-full max-w-xl my-4 rounded-xl border border-zinc-800/80 bg-[#09090b] p-4 text-zinc-200 shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-zinc-800/60">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-zinc-900 border border-zinc-700/60 flex items-center justify-center text-zinc-300">
            <Mail className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Controlled Action Approval
            </h4>
            <div className="text-sm font-medium text-zinc-100">
              Send Email via Gmail
            </div>
          </div>
        </div>

        {/* Status Pill */}
        {action.status === 'executed' && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Check className="w-3.5 h-3.5" />
            Sent
          </span>
        )}
        {action.status === 'declined' && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-zinc-800/80 text-zinc-400 border border-zinc-700/50">
            <X className="w-3.5 h-3.5" />
            Declined
          </span>
        )}
        {action.status === 'failed' && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
            <AlertCircle className="w-3.5 h-3.5" />
            Failed
          </span>
        )}
        {action.status === 'pending' && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
            Approval Required
          </span>
        )}
      </div>

      {/* Email Parameters Details */}
      <div className="space-y-2 mb-4 text-xs">
        <div className="flex items-baseline gap-2">
          <span className="text-zinc-500 w-14 shrink-0 font-medium">To:</span>
          <span className="font-mono text-zinc-300 select-all bg-zinc-900/60 px-2 py-0.5 rounded border border-zinc-800/50">
            {to}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-zinc-500 w-14 shrink-0 font-medium">Subject:</span>
          <span className="font-medium text-zinc-200 select-all">
            {subject}
          </span>
        </div>
        <div className="flex flex-col gap-1 pt-1">
          <span className="text-zinc-500 font-medium">Body:</span>
          <div className="p-2.5 rounded-lg bg-[#000000] border border-zinc-800/80 text-zinc-300 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">
            {body}
          </div>
        </div>
      </div>

      {/* Action Footer */}
      {action.status === 'pending' && (
        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-zinc-800/60">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => handleDecision('decline')}
            className="px-3.5 py-1.5 rounded-lg border border-zinc-700/80 text-zinc-300 font-medium text-xs hover:bg-zinc-800 hover:text-white transition-colors disabled:opacity-50"
          >
            Decline
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => handleDecision('confirm')}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-zinc-100 text-zinc-950 font-semibold text-xs hover:bg-white transition-colors shadow disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Check className="w-3.5 h-3.5" />
                Send Email
              </>
            )}
          </button>
        </div>
      )}

      {action.status === 'failed' && action.result?.error && (
        <div className="mt-2 text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded p-2">
          {action.result.error}
        </div>
      )}
    </div>
  );
};
