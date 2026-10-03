import { useState } from 'react';
import type { FC } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Pencil, Copy, Check, RotateCcw, GitBranch, ArrowRight, FileText, Download, PanelRight } from 'lucide-react';
import type { ChatMessage, ThreadProposal, Artifact } from '../types';
import { CodeBlock } from './CognitiveWidgets';

interface ChatMessageViewProps {
  message: ChatMessage;
  onEditAndResend: (messageId: string, newContent: string) => void;
  onRegenerate?: (messageId: string) => void;
  onOpenThread?: (threadId: string) => void;
  onRespondProposal?: (messageId: string, action: 'accept' | 'decline') => void;
  onOpenArtifact?: (artifact: Artifact) => void;
}

export const ChatMessageView: FC<ChatMessageViewProps> = ({
  message,
  onEditAndResend,
  onRegenerate,
  onOpenThread,
  onRespondProposal,
  onOpenArtifact,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.content);
  const [copied, setCopied] = useState(false);

  const isUser = message.role === 'user';

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveEdit = () => {
    if (!editText.trim() || editText === message.content) {
      setIsEditing(false);
      return;
    }
    setIsEditing(false);
    onEditAndResend(message.id, editText.trim());
  };

  if (isUser) {
    return (
      <div className="flex flex-col items-end mb-6 group w-full">
        <div className="max-w-[85%] sm:max-w-[75%] rounded-[20px] bg-[var(--bg-card)] px-4 py-3 text-[var(--text-primary)]">
          {isEditing ? (
            <div className="flex flex-col gap-2.5 min-w-[280px] sm:min-w-[400px]">
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSaveEdit();
                  }
                  if (e.key === 'Escape') {
                    setIsEditing(false);
                    setEditText(message.content);
                  }
                }}
                className="w-full p-2.5 text-[16px] font-medium bg-[var(--bg-modal-inner)] rounded-xl text-[var(--text-primary)] outline-none resize-none"
                rows={Math.min(6, Math.max(2, editText.split('\n').length))}
                autoFocus
              />
              <div className="flex items-center justify-end gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditing(false);
                    setEditText(message.content);
                  }}
                  className="px-3 py-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg hover:bg-[var(--bg-card-hover)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  className="px-3 py-1.5 bg-[var(--text-primary)] text-[var(--bg-primary)] font-medium rounded-lg hover:opacity-90 transition-opacity"
                >
                  Send
                </button>
              </div>
            </div>
          ) : (
            <p className="text-[16.5px] sm:text-[17px] font-medium leading-relaxed whitespace-pre-wrap selection:bg-zinc-700">
              {message.content}
            </p>
          )}
        </div>

        {/* User prompt action buttons: copy & edit, visible ONLY when hovered on prompt area */}
        {!isEditing && (
          <div className="flex items-center gap-1 mt-1 mr-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={handleCopy}
              title="Copy prompt"
              className="p-1 rounded text-[var(--text-dim)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditText(message.content);
                setIsEditing(true);
              }}
              title="Edit prompt"
              className="p-1 rounded text-[var(--text-dim)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors"
            >
              <Pencil className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    );
  }

  // Assistant Message
  let proposal: ThreadProposal | null = null;
  if (message.thread_proposal) {
    if (typeof message.thread_proposal === 'object') {
      proposal = message.thread_proposal as ThreadProposal;
    } else {
      try {
        proposal = JSON.parse(message.thread_proposal);
      } catch {
        proposal = null;
      }
    }
  }

  return (
    <div className="flex flex-col items-start mb-8 group w-full max-w-full">
      {/* Main Markdown Response Content or Single-Line Flowing Status */}
      <div className="w-full text-[var(--text-primary)] font-medium prose-velocity">
        {message.content ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // Explicit Markdown lists parsing with proper indent, disc, and number styles
              ul({ children }) {
                return (
                  <ul className="list-disc pl-5 my-2.5 space-y-1 text-[var(--text-primary)] font-medium marker:text-zinc-500">
                    {children}
                  </ul>
                );
              },
              ol({ children }) {
                return (
                  <ol className="list-decimal pl-5 my-2.5 space-y-1 text-[var(--text-primary)] font-medium marker:text-zinc-500">
                    {children}
                  </ol>
                );
              },
              li({ children }) {
                return (
                  <li className="leading-relaxed pl-1">
                    {children}
                  </li>
                );
              },
              // Code components: CodeBlock for pre blocks, accent light blue for inline code
              code({ inline, className, children, ...props }: any) {
                const match = /language-(\w+)/.exec(className || '');
                const value = String(children).replace(/\n$/, '');

                if (!inline && match) {
                  return <CodeBlock language={match[1]} value={value} />;
                }

                if (!inline && value.includes('\n')) {
                  return <CodeBlock language="text" value={value} />;
                }

                // Inline code: styled with the app's accent color (light blue)
                return (
                  <code
                    className="px-1.5 py-0.5 rounded font-mono text-[14px] sm:text-[14.5px] font-medium"
                    style={{
                      color: 'var(--accent-blue)',
                      backgroundColor: 'var(--accent-blue-bg)',
                    }}
                    {...props}
                  >
                    {children}
                  </code>
                );
              },
              p({ children }) {
                return <p className="my-2.5 leading-relaxed font-medium">{children}</p>;
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
        ) : message.isStreaming ? (
          <div className="flex items-center py-1.5 select-none">
            <span className="shimmer-text text-[15.5px] sm:text-[16px] font-medium tracking-tight">
              {message.statusText || 'Thinking'}
            </span>
          </div>
        ) : null}
      </div>

      {/* Inline Document Artifact Card */}
      {message.artifact && (
        <div className="mt-3.5 p-4 rounded-2xl border border-zinc-800 bg-zinc-950/80 shadow-md max-w-xl w-full">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-1.5 text-zinc-400">
              <FileText className="w-4 h-4 text-sky-400" />
              <span className="text-[11px] font-semibold uppercase tracking-wider">
                {message.artifact.artifact_type.replace(/_/g, ' ')}
              </span>
            </div>
            <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full border bg-zinc-900 border-zinc-800 text-zinc-400">
              v{message.artifact.version}
            </span>
          </div>

          <h4 className="text-[15px] font-semibold text-zinc-100 mb-1">
            {message.artifact.title}
          </h4>

          {message.artifact.summary && (
            <p className="text-[13.5px] text-zinc-400 mb-3 leading-relaxed">
              {message.artifact.summary}
            </p>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => onOpenArtifact?.(message.artifact!)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-900 font-medium text-xs hover:bg-white transition-colors"
            >
              <PanelRight className="w-3.5 h-3.5" />
              Open in Canvas
            </button>
            <a
              href={`/api/artifacts/${message.artifact.id}/export/pdf`}
              download={`${message.artifact.title.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')}.pdf`}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-300 font-medium text-xs hover:bg-zinc-900 hover:text-white transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Export PDF
            </a>
          </div>
        </div>
      )}

      {/* Side Chat Proposal Card */}
      {proposal && (
        <div className="mt-3.5 p-4 rounded-2xl border border-zinc-800 bg-zinc-950/70 shadow-md max-w-xl w-full">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-1.5 text-zinc-400">
              <GitBranch className="w-4 h-4 text-sky-400" />
              <span className="text-[11px] font-semibold uppercase tracking-wider">
                Proposed Side Chat
              </span>
            </div>
            <span
              className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full border ${
                proposal.status === 'accepted'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : proposal.status === 'declined'
                  ? 'bg-zinc-800/80 text-zinc-400 border-zinc-700'
                  : 'bg-sky-500/10 text-sky-400 border-sky-500/30'
              }`}
            >
              {proposal.status === 'accepted'
                ? 'Branched'
                : proposal.status === 'declined'
                ? 'Declined'
                : 'Awaiting Approval'}
            </span>
          </div>

          <h4 className="text-[15px] font-semibold text-zinc-100 mb-1">
            {proposal.title}
          </h4>
          {proposal.reason && (
            <p className="text-[13.5px] text-zinc-400 mb-3 leading-relaxed">
              {proposal.reason}
            </p>
          )}

          {(!proposal.status || proposal.status === 'pending') && (
            <div className="flex items-center gap-2 pt-1">
              {message.isStreaming ? (
                <span className="text-xs text-zinc-500 italic">
                  Finalizing proposal...
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onRespondProposal?.(message.id, 'accept')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-900 font-medium text-xs hover:bg-white transition-colors"
                  >
                    <GitBranch className="w-3.5 h-3.5" />
                    Open Side Chat
                  </button>
                  <button
                    type="button"
                    onClick={() => onRespondProposal?.(message.id, 'decline')}
                    className="px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-300 font-medium text-xs hover:bg-zinc-900 hover:text-white transition-colors"
                  >
                    Continue Here
                  </button>
                </>
              )}
            </div>
          )}

          {proposal.status === 'accepted' && proposal.thread_id && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => onOpenThread?.(proposal.thread_id!)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-200 font-medium text-xs hover:bg-zinc-800 hover:text-white transition-colors"
              >
                <GitBranch className="w-3.5 h-3.5 text-emerald-400" />
                Jump to Side Chat
                <ArrowRight className="w-3.5 h-3.5 text-zinc-400" />
              </button>
            </div>
          )}

          {proposal.status === 'declined' && (
            <p className="text-xs text-zinc-500 italic pt-1">
              Continued right in main timeline.
            </p>
          )}
        </div>
      )}

      {/* 5. Bottom Message Actions: Copy, Regenerate — ALWAYS VISIBLE on every assistant response */}
      {!message.isStreaming && message.content && (
        <div className="flex items-center gap-1 mt-2 text-[var(--text-dim)]">
          <button
            type="button"
            onClick={handleCopy}
            title="Copy response"
            className="p-1 rounded text-[var(--text-dim)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
          </button>

          {onRegenerate && (
            <button
              type="button"
              onClick={() => onRegenerate(message.id)}
              title="Regenerate response"
              className="p-1 rounded text-[var(--text-dim)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
