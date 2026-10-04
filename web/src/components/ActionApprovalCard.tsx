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
    <div className="w-full max-w-xl my-4 rounded-2xl bg-[#141416] p-4 text-neutral-200 shadow-2xl select-none">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center shrink-0">
            <Mail className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-[10.5px] font-semibold uppercase tracking-wider text-neutral-400">
              Controlled Action Approval
            </h4>
            <div className="text-sm font-medium text-white">
              Send Email via Gmail
            </div>
          </div>
        </div>

        {/* Status Pill */}
        {action.status === 'executed' && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-400">
            <Check className="w-3.5 h-3.5" />
            Sent
          </span>
        )}
        {action.status === 'declined' && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-neutral-800 text-neutral-400">
            <X className="w-3.5 h-3.5" />
            Declined
          </span>
        )}
        {action.status === 'failed' && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-red-500/15 text-red-400">
            <AlertCircle className="w-3.5 h-3.5" />
            Failed
          </span>
        )}
        {action.status === 'pending' && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-500/15 text-amber-400">
            Approval Required
          </span>
        )}
      </div>

      {/* Email Parameters Details */}
      <div className="space-y-2 mb-4 text-xs">
        <div className="flex items-baseline gap-2">
          <span className="text-neutral-500 w-14 shrink-0 font-medium">To:</span>
          <span className="font-mono text-neutral-200 select-all bg-[#1c1c1f] px-2.5 py-1 rounded-lg">
            {to}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-neutral-500 w-14 shrink-0 font-medium">Subject:</span>
          <span className="font-medium text-neutral-200 select-all">
            {subject}
          </span>
        </div>
        <div className="flex flex-col gap-1.5 pt-1">
          <span className="text-neutral-500 font-medium">Body:</span>
          <div className="p-3 rounded-xl bg-[#09090b] text-neutral-300 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">
            {body}
          </div>
        </div>
      </div>

      {/* Action Footer */}
      {action.status === 'pending' && (
        <div className="flex items-center justify-end gap-2.5 pt-2">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => handleDecision('decline')}
            className="px-3.5 py-1.5 rounded-xl text-neutral-400 font-medium text-xs hover:text-white hover:bg-[#1e1e24] active:scale-95 transition-all disabled:opacity-50"
          >
            Decline
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => handleDecision('confirm')}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-white text-black font-semibold text-xs hover:bg-neutral-200 active:scale-95 transition-all shadow-md disabled:opacity-50"
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
        <div className="mt-2 text-xs text-red-400 bg-red-950/20 rounded-xl p-2.5">
          {action.result.error}
        </div>
      )}
    </div>
  );
};
