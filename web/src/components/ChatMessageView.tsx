import { useState } from 'react';
import type { FC } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Pencil, Copy, Check, RotateCcw, LineSquiggle, FileCode2 } from 'lucide-react';
import type { ChatMessage, ThreadProposal, Artifact } from '../types';
import { CodeBlock } from './CognitiveWidgets';

interface ChatMessageViewProps {
  message: ChatMessage;
  isThread?: boolean;
  onEditAndResend: (messageId: string, newContent: string) => void;
  onRegenerate?: (messageId: string) => void;
  onOpenThread?: (threadId: string) => void;
  onOpenArtifact?: (artifact: Artifact) => void;
  onRespondProposal?: (messageId: string, action: 'accept' | 'decline') => void;
  onRespondAction?: (actionId: string, decision: 'confirm' | 'decline') => void | Promise<void>;
}

export const ChatMessageView: FC<ChatMessageViewProps> = ({
  message,
  isThread = false,
  onEditAndResend,
  onRegenerate,
  onOpenThread,
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

  // Extract thread proposal if any
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

  // Detect proactive routine and clean content
  const detectRoutine = (content: string) => {
    const trimmed = content.trim();
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('# morning briefing') || lower.startsWith('**morning briefing') || lower.startsWith('morning briefing:')) {
      const clean = trimmed.replace(/^(#*\s*\*?\*?morning briefing\*?\*?:?\s*\n*)/i, '').trim();
      return { type: 'briefing' as const, label: 'Morning Briefing', content: clean };
    }
    if (lower.startsWith('# evening reflection') || lower.startsWith('**evening reflection') || lower.startsWith('evening reflection:')) {
      const clean = trimmed.replace(/^(#*\s*\*?\*?evening reflection\*?\*?:?\s*\n*)/i, '').trim();
      return { type: 'reflection' as const, label: 'Evening Reflection', content: clean };
    }
    if (lower.startsWith('# reminder') || lower.startsWith('**reminder') || lower.startsWith('reminder:')) {
      const clean = trimmed.replace(/^(#*\s*\*?\*?reminder\*?\*?:?\s*\n*)/i, '').trim();
      return { type: 'reminder' as const, label: 'Scheduled Reminder', content: clean };
    }
    return null;
  };

  const routine = !isUser && message.content ? detectRoutine(message.content) : null;
  const displayContent = routine ? routine.content : message.content;

  // 1. User Message (Capsule on right)
  if (isUser) {
    return (
      <div className="flex flex-col items-end mb-2 group w-full select-none">
        <div className="max-w-[85%] sm:max-w-[78%] rounded-2xl bg-[#1e1e22] px-4 py-2 text-neutral-100 shadow-sm border-none">
          {isEditing ? (
            <div className="flex flex-col gap-2 min-w-[280px] sm:min-w-[380px]">
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
                className="w-full p-2 text-[15px] font-medium bg-[#141416] rounded-xl text-white outline-none resize-none border-none"
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
                  className="px-3 py-1.5 text-neutral-400 hover:text-white rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  className="px-3 py-1.5 bg-white text-black font-semibold rounded-lg hover:opacity-90 transition-opacity"
                >
                  Send
                </button>
              </div>
            </div>
          ) : (
            <p className="text-[15.5px] font-medium leading-relaxed whitespace-pre-wrap selection:bg-neutral-700">
              {message.content}
            </p>
          )}
        </div>

        {/* Hover action buttons */}
        {!isEditing && (
          <div className="flex items-center gap-1 mt-1 mr-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={handleCopy}
              title="Copy"
              className="p-1 rounded-lg text-neutral-500 hover:text-neutral-200 hover:bg-[#18181b] transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditText(message.content);
                setIsEditing(true);
              }}
              title="Edit"
              className="p-1 rounded-lg text-neutral-500 hover:text-neutral-200 hover:bg-[#18181b] transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    );
  }

  // 2. Assistant Message
  // For Side Chat (Thread): Engineering workspace mode (full-width prose, streaming, thinking)
  // For Main Timeline: WhatsApp / iMessage peer-to-peer capsule mode (atomic delivery, 3-dot typing indicator)

  return (
    <div className={`flex flex-col mb-3 group w-full ${isThread ? 'items-start' : 'items-start'}`}>
      {/* Standalone Resource Pill for Branched Thread (Matching inspiration) */}
      {proposal && proposal.status === 'accepted' && proposal.thread_id && (
        <div
          onClick={() => onOpenThread?.(proposal!.thread_id!)}
          className="mb-3 flex items-center gap-3.5 bg-[#1c1c1e] hover:bg-[#252528] active:scale-[0.98] rounded-2xl px-4 py-2.5 cursor-pointer max-w-sm transition-all select-none border-none group/pill shadow-md"
        >
          <div className="w-9 h-9 rounded-xl bg-violet-500/15 text-violet-400 flex items-center justify-center flex-shrink-0 group-hover/pill:scale-105 transition-transform">
            <LineSquiggle className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-white truncate">{proposal.title}</div>
            <div className="text-xs text-neutral-400">Thread</div>
          </div>
        </div>
      )}

      {/* Standalone Resource Pill for Document Artifact (Matching inspiration) */}
      {message.artifact && (
        <div
          onClick={() => onOpenArtifact?.(message.artifact!)}
          className="mb-3 flex items-center gap-3.5 bg-[#1c1c1e] hover:bg-[#252528] active:scale-[0.98] rounded-2xl px-4 py-2.5 cursor-pointer max-w-sm transition-all select-none border-none group/pill shadow-md"
        >
          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center flex-shrink-0 group-hover/pill:scale-105 transition-transform">
            <FileCode2 className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-white truncate">{message.artifact.title}</div>
            <div className="text-xs text-neutral-400">Artifact</div>
          </div>
        </div>
      )}

      {/* Message Body */}
      {isThread ? (
        /* Side Chat (Engineering Workspace Layout) */
        <div className="w-full text-neutral-100 font-medium prose-velocity">
          {message.content ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                ul({ children }) {
                  return <ul className="list-disc pl-5 my-2 space-y-1 marker:text-neutral-500">{children}</ul>;
                },
                ol({ children }) {
                  return <ol className="list-decimal pl-5 my-2 space-y-1 marker:text-neutral-500">{children}</ol>;
                },
                li({ children }) {
                  return <li className="leading-relaxed pl-1">{children}</li>;
                },
                code({ inline, className, children, ...props }: any) {
                  const match = /language-(\w+)/.exec(className || '');
                  const value = String(children).replace(/\n$/, '');
                  if (!inline && match) {
                    return <CodeBlock language={match[1]} value={value} />;
                  }
                  if (!inline && value.includes('\n')) {
                    return <CodeBlock language="text" value={value} />;
                  }
                  return (
                    <code
                      className="px-1.5 py-0.5 rounded font-mono text-[13.5px] bg-[#18181b] text-sky-300"
                      {...props}
                    >
                      {children}
                    </code>
                  );
                },
                p({ children }) {
                  return <p className="my-2 leading-relaxed">{children}</p>;
                },
              }}
            >
              {message.content}
            </ReactMarkdown>
          ) : message.isStreaming ? (
            <div className="flex items-center py-1.5 select-none">
              <span className="shimmer-text text-[15px] font-medium tracking-tight text-neutral-400">
                {message.statusText || 'Thinking...'}
              </span>
            </div>
          ) : null}
        </div>
      ) : (
        /* Main Timeline (Peer-to-Peer Capsule Layout) */
        message.isStreaming && !displayContent ? (
          /* 3-Dot Bouncing Typing Indicator for Atomic Delivery */
          <div className="flex items-center gap-1.5 bg-[#121214] px-4 py-2.5 rounded-2xl w-fit shadow-sm">
            <span
              className="w-2 h-2 rounded-full bg-neutral-400 animate-bounce"
              style={{ animationDelay: '0ms' }}
            />
            <span
              className="w-2 h-2 rounded-full bg-neutral-400 animate-bounce"
              style={{ animationDelay: '150ms' }}
            />
            <span
              className="w-2 h-2 rounded-full bg-neutral-400 animate-bounce"
              style={{ animationDelay: '300ms' }}
            />
          </div>
        ) : displayContent ? (
          <div className="max-w-[85%] sm:max-w-[78%] rounded-2xl bg-[#121214] px-4 py-2 text-neutral-100 shadow-sm border-none">
            {/* Proactive Glowing Routine Header */}
            {routine && (
              <div
                className={`text-[11px] font-bold tracking-wider uppercase mb-1.5 select-none ${
                  routine.type === 'briefing'
                    ? 'text-amber-400 [text-shadow:0_0_12px_rgba(245,158,11,0.6)]'
                    : routine.type === 'reflection'
                    ? 'text-indigo-400 [text-shadow:0_0_12px_rgba(99,102,241,0.6)]'
                    : 'text-sky-400 [text-shadow:0_0_12px_rgba(14,165,233,0.6)]'
                }`}
              >
                {routine.label}
              </div>
            )}

            <div className="prose-velocity text-[15px] leading-relaxed text-neutral-100 font-medium">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  ul({ children }) {
                    return <ul className="list-disc pl-5 my-1.5 space-y-1 marker:text-neutral-500">{children}</ul>;
                  },
                  ol({ children }) {
                    return <ol className="list-decimal pl-5 my-1.5 space-y-1 marker:text-neutral-500">{children}</ol>;
                  },
                  li({ children }) {
                    return <li className="leading-relaxed pl-1">{children}</li>;
                  },
                  code({ inline, className, children, ...props }: any) {
                    const match = /language-(\w+)/.exec(className || '');
                    const value = String(children).replace(/\n$/, '');
                    if (!inline && match) {
                      return <CodeBlock language={match[1]} value={value} />;
                    }
                    if (!inline && value.includes('\n')) {
                      return <CodeBlock language="text" value={value} />;
                    }
                    return (
                      <code
                        className="px-1.5 py-0.5 rounded font-mono text-[13.5px] bg-[#1e1e24] text-sky-300"
                        {...props}
                      >
                        {children}
                      </code>
                    );
                  },
                  p({ children }) {
                    return <p className="my-1.5 leading-relaxed">{children}</p>;
                  },
                }}
              >
                {displayContent}
              </ReactMarkdown>
            </div>
          </div>
        ) : null
      )}

      {/* Assistant Turn Actions (Copy, Regenerate) */}
      {!message.isStreaming && displayContent && (
        <div className="flex items-center gap-1 mt-1 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={handleCopy}
            title="Copy response"
            className="p-1 rounded-lg text-neutral-500 hover:text-neutral-200 hover:bg-[#18181b] transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          {onRegenerate && (
            <button
              type="button"
              onClick={() => onRegenerate(message.id)}
              title="Regenerate turn"
              className="p-1 rounded-lg text-neutral-500 hover:text-neutral-200 hover:bg-[#18181b] transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
