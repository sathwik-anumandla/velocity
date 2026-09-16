import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Pencil, Copy, Check, RotateCcw } from 'lucide-react';
import type { ChatMessage } from '../types';
import { AgenticWorkflowStepper, ReasoningBlock, ToolCallCard, CodeBlock } from './CognitiveWidgets';

interface ChatMessageViewProps {
  message: ChatMessage;
  onEditAndResend: (messageId: string, newContent: string) => void;
  onRegenerateLast?: () => void;
  isLastAssistant?: boolean;
}

export const ChatMessageView: React.FC<ChatMessageViewProps> = ({
  message,
  onEditAndResend,
  onRegenerateLast,
  isLastAssistant,
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
      <div className="flex flex-col items-end mb-6 group">
        <div className="max-w-[85%] sm:max-w-[75%] rounded-3xl bg-[#1C1C1F] border border-[#2A2A30] px-4 py-3 text-white">
          {isEditing ? (
            <div className="flex flex-col gap-2 min-w-[280px] sm:min-w-[400px]">
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
                className="w-full p-2 text-sm bg-[#121214] border border-[#3A3A42] rounded-xl text-white outline-none resize-none focus:border-zinc-400"
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
                  className="px-3 py-1 text-zinc-400 hover:text-white rounded-lg hover:bg-[#25252A] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  className="px-3 py-1 bg-white text-black font-medium rounded-lg hover:bg-zinc-200 transition-colors"
                >
                  Send
                </button>
              </div>
            </div>
          ) : (
            <p className="text-[14.5px] leading-relaxed whitespace-pre-wrap selection:bg-zinc-700">{message.content}</p>
          )}
        </div>

        {/* User action buttons: edit & copy */}
        {!isEditing && (
          <div className="flex items-center gap-1 mt-1 mr-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={() => {
                setEditText(message.content);
                setIsEditing(true);
              }}
              title="Edit prompt"
              className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#202024] transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleCopy}
              title="Copy message"
              className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#202024] transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        )}
      </div>
    );
  }

  // Assistant Message
  return (
    <div className="flex flex-col items-start mb-7 group max-w-full">
      {/* 1. Agentic Workflow Stepper (if active or reported) */}
      {message.agenticStep && (
        <AgenticWorkflowStepper step={message.agenticStep} isStreaming={message.isStreaming} />
      )}

      {/* 2. Tool Calls */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="flex flex-col w-full max-w-2xl mb-2">
          {message.toolCalls.map((tc, idx) => (
            <ToolCallCard key={idx} toolCall={tc} />
          ))}
        </div>
      )}

      {/* 3. Reasoning / Thought Process Drawer */}
      {message.reasoning && (
        <div className="w-full max-w-2xl">
          <ReasoningBlock reasoning={message.reasoning} isStreaming={message.isStreaming} />
        </div>
      )}

      {/* 4. Main Markdown Response Content */}
      <div className="w-full text-zinc-100 prose-velocity">
        {message.content ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ inline, className, children, ...props }: any) {
                const match = /language-(\w+)/.exec(className || '');
                const value = String(children).replace(/\n$/, '');
                return !inline && match ? (
                  <CodeBlock language={match[1]} value={value} />
                ) : (
                  <code className={className} {...props}>
                    {children}
                  </code>
                );
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
        ) : message.isStreaming ? (
          <div className="flex items-center gap-2 text-xs font-mono text-zinc-400 py-1">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />
            <span>Velocity is thinking...</span>
          </div>
        ) : null}
      </div>

      {/* 5. Bottom Message Actions: Copy, Regenerate */}
      {!message.isStreaming && message.content && (
        <div className="flex items-center gap-2 mt-2 pt-1 opacity-0 group-hover:opacity-100 transition-opacity text-xs text-zinc-400">
          <button
            type="button"
            onClick={handleCopy}
            title="Copy message"
            className="flex items-center gap-1 px-2 py-1 rounded hover:bg-[#1A1A20] hover:text-white transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          {isLastAssistant && onRegenerateLast && (
            <button
              type="button"
              onClick={onRegenerateLast}
              title="Regenerate response"
              className="flex items-center gap-1 px-2 py-1 rounded hover:bg-[#1A1A20] hover:text-white transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Regenerate</span>
            </button>
          )}

          {message.memory_status && (
            <span
              className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded border ${
                message.memory_status === 'ok'
                  ? 'border-emerald-500/20 text-emerald-400/80 bg-emerald-500/5'
                  : 'border-amber-500/20 text-amber-400/80 bg-amber-500/5'
              }`}
            >
              Memory {message.memory_status}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
