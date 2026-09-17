import { useState } from 'react';
import type { FC } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Pencil, Copy, Check, RotateCcw } from 'lucide-react';
import type { ChatMessage } from '../types';
import { CodeBlock } from './CognitiveWidgets';

interface ChatMessageViewProps {
  message: ChatMessage;
  onEditAndResend: (messageId: string, newContent: string) => void;
  onRegenerate?: (messageId: string) => void;
}

export const ChatMessageView: FC<ChatMessageViewProps> = ({
  message,
  onEditAndResend,
  onRegenerate,
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
                className="w-full p-2.5 text-[14.5px] font-medium bg-[var(--bg-modal-inner)] rounded-xl text-[var(--text-primary)] outline-none resize-none"
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
            <p className="text-[15px] font-medium leading-relaxed whitespace-pre-wrap selection:bg-zinc-700">
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
                    className="px-1.5 py-0.5 rounded font-mono text-[13px] font-medium"
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
            <span className="shimmer-text text-[15px] font-medium tracking-tight">
              {message.statusText || 'Thinking'}
            </span>
          </div>
        ) : null}
      </div>

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
