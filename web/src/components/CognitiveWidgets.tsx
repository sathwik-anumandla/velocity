import { useState } from 'react';
import type { FC } from 'react';
import { ChevronDown, ChevronRight, Copy, Check, Sparkles, Globe, Database, Brain, Cpu, Terminal } from 'lucide-react';
import type { ToolCallState, AgenticStep } from '../types';

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
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#141414] text-xs text-zinc-300 font-mono mb-2">
      {getStepIcon(step?.step)}
      <span className="capitalize font-semibold text-zinc-200">{step?.step || 'Thinking'}</span>
      {step?.message && <span className="text-zinc-500 text-[11px]">— {step.message}</span>}
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
    <div className="mb-3 rounded-xl bg-[#141414] overflow-hidden text-xs">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between w-full px-3.5 py-2.5 text-zinc-400 hover:text-zinc-200 hover:bg-[#1A1A1E] transition-colors"
      >
        <div className="flex items-center gap-2 font-mono">
          <Cpu className="w-3.5 h-3.5 text-zinc-500" />
          <span>Thought process</span>
          {isStreaming && <span className="inline-block w-1.5 h-1.5 rounded-full bg-zinc-400 animate-ping ml-1" />}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-zinc-500">{reasoning.length} chars</span>
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />}
        </div>
      </button>

      {isExpanded && (
        <div className="px-3.5 py-3 bg-[#0A0A0A] text-zinc-300 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap max-h-72 overflow-y-auto">
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
    <div className="my-1.5 rounded-xl bg-[#141414] text-xs font-mono overflow-hidden">
      <div
        onClick={() => toolCall.result && setIsExpanded(!isExpanded)}
        className={`flex items-center justify-between px-3.5 py-2.5 cursor-pointer hover:bg-[#1A1A1E] transition-colors ${
          !toolCall.result ? 'cursor-default' : ''
        }`}
      >
        <div className="flex items-center gap-2">
          {getIcon()}
          <span className="font-semibold text-zinc-200">{cleanToolName()}</span>
          {toolCall.query && (
            <span className="text-zinc-500 text-[11px] truncate max-w-xs sm:max-w-md">"{toolCall.query}"</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {toolCall.status === 'running' ? (
            <span className="inline-block w-2 h-2 rounded-full bg-zinc-400 animate-pulse" />
          ) : (
            <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-bold">Done</span>
          )}
          {toolCall.result && (
            isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
          )}
        </div>
      </div>

      {isExpanded && toolCall.result && (
        <div className="px-3.5 py-3 bg-[#0A0A0A] text-[11px] text-zinc-300 whitespace-pre-wrap max-h-48 overflow-y-auto">
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

  return (
    <div className="relative my-3 rounded-xl bg-[#0D0D10] overflow-hidden text-xs">
      <div className="flex items-center justify-between px-3.5 py-2 bg-[#141418] text-zinc-400 font-mono text-[11px]">
        <span>{language || 'text'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-[#202026] text-zinc-300 hover:text-white transition-colors"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-white" />
              <span className="text-white">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-3.5 overflow-x-auto text-zinc-200 font-mono text-[12px] leading-relaxed">
        <code>{value}</code>
      </pre>
    </div>
  );
};
