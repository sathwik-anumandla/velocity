import { useState } from 'react';
import type { FC } from 'react';
import { ChevronDown, ChevronRight, Copy, Check, Sparkles, Globe, Database, Brain, Cpu, Terminal } from 'lucide-react';
import type { ToolCallState, AgenticStep } from '../types';
import { highlightCode } from '../utils/prism';

export const AgenticWorkflowStepper: FC<{ step?: AgenticStep; isStreaming?: boolean }> = ({
  step,
  isStreaming,
}) => {
  if (!step && !isStreaming) return null;

  const getStepIcon = (name?: string) => {
    switch (name?.toLowerCase()) {
      case 'searching':
        return <Globe className="w-3.5 h-3.5 text-zinc-400 animate-spin" />;
      case 'recalling':
        return <Database className="w-3.5 h-3.5 text-zinc-400" />;
      case 'reflecting':
        return <Brain className="w-3.5 h-3.5 text-zinc-400" />;
      case 'planning':
      case 'synthesizing':
      default:
        return <Sparkles className="w-3.5 h-3.5 text-zinc-400" />;
    }
  };

  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--bg-card)] text-xs text-[var(--text-secondary)] font-mono mb-2">
      {getStepIcon(step?.step)}
      <span className="capitalize font-semibold text-[var(--text-primary)]">{step?.step || 'Thinking'}</span>
      {step?.message && <span className="text-[var(--text-muted)] text-[11px]">— {step.message}</span>}
      {isStreaming && <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-pulse ml-0.5" />}
    </div>
  );
};

export const ReasoningBlock: FC<{ reasoning: string; isStreaming?: boolean }> = ({
  reasoning,
  isStreaming,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!reasoning.trim()) return null;

  return (
    <div className="mb-3 rounded-xl bg-[var(--bg-card)] overflow-hidden text-xs">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between w-full px-3.5 py-2.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
      >
        <div className="flex items-center gap-2 font-mono">
          <Cpu className="w-3.5 h-3.5 text-[var(--text-dim)]" />
          <span>Thought process</span>
          {isStreaming && <span className="inline-block w-1.5 h-1.5 rounded-full bg-zinc-400 animate-ping ml-1" />}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-[var(--text-dim)]">{reasoning.length} chars</span>
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-[var(--text-dim)]" /> : <ChevronRight className="w-3.5 h-3.5 text-[var(--text-dim)]" />}
        </div>
      </button>

      {isExpanded && (
        <div className="px-3.5 py-3 bg-[var(--bg-modal-inner)] text-[var(--text-secondary)] font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap max-h-72 overflow-y-auto">
          {reasoning}
        </div>
      )}
    </div>
  );
};

export const ToolCallCard: FC<{ toolCall: ToolCallState }> = ({ toolCall }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const getIcon = () => {
    switch (toolCall.tool) {
      case 'tavily_search':
        return <Globe className="w-3.5 h-3.5 text-zinc-400" />;
      case 'consult_memory':
        return <Database className="w-3.5 h-3.5 text-zinc-400" />;
      case 'read_mental_model':
        return <Brain className="w-3.5 h-3.5 text-zinc-400" />;
      default:
        return <Terminal className="w-3.5 h-3.5 text-zinc-400" />;
    }
  };

  const cleanToolName = () => {
    switch (toolCall.tool) {
      case 'tavily_search':
        return 'Web Search';
      case 'consult_memory':
        return 'Memory Recall';
      case 'read_mental_model':
        return 'Mental Model';
      default:
        return toolCall.tool;
    }
  };

  return (
    <div className="my-1.5 rounded-xl bg-[var(--bg-card)] text-xs font-mono overflow-hidden">
      <div
        onClick={() => toolCall.result && setIsExpanded(!isExpanded)}
        className={`flex items-center justify-between px-3.5 py-2.5 cursor-pointer hover:bg-[var(--bg-card-hover)] transition-colors ${
          !toolCall.result ? 'cursor-default' : ''
        }`}
      >
        <div className="flex items-center gap-2">
          {getIcon()}
          <span className="font-semibold text-[var(--text-primary)]">{cleanToolName()}</span>
          {toolCall.query && (
            <span className="text-[var(--text-muted)] text-[11px] truncate max-w-xs sm:max-w-md">"{toolCall.query}"</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {toolCall.status === 'running' ? (
            <span className="inline-block w-2 h-2 rounded-full bg-zinc-400 animate-pulse" />
          ) : (
            <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-bold">Done</span>
          )}
          {toolCall.result && (
            isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-[var(--text-dim)]" /> : <ChevronRight className="w-3.5 h-3.5 text-[var(--text-dim)]" />
          )}
        </div>
      </div>

      {isExpanded && toolCall.result && (
        <div className="px-3.5 py-3 bg-[var(--bg-modal-inner)] text-[11px] text-[var(--text-secondary)] whitespace-pre-wrap max-h-48 overflow-y-auto">
          {toolCall.result}
        </div>
      )}
    </div>
  );
};

export const CodeBlock: FC<{ language?: string; value: string }> = ({ language, value }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const highlightedHtml = highlightCode(value, language);

  return (
    <div className="relative my-3 rounded-xl bg-[var(--bg-code)] overflow-hidden text-xs">
      {/* Header: plain language text on top-left (no bg highlight) and ONLY copy icon on top-right */}
      <div className="flex items-center justify-between px-3.5 pt-2.5 pb-1 select-none">
        <span className="text-[var(--text-dim)] font-mono text-xs lowercase tracking-wide">
          {language || 'code'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          title={copied ? 'Copied to clipboard' : 'Copy code'}
          className="p-1 rounded hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
      <pre className="p-3.5 pt-1 overflow-x-auto font-mono text-[13.5px] sm:text-[14px] leading-relaxed">
        <code
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          className="font-mono"
        />
      </pre>
    </div>
  );
};
