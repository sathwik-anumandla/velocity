import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Check, Sparkles, Globe, Database, Brain, Cpu } from 'lucide-react';
import type { ToolCallState, AgenticStep } from '../types';

export const AgenticWorkflowStepper: React.FC<{ step?: AgenticStep; isStreaming?: boolean }> = ({
  step,
  isStreaming,
}) => {
  if (!step && !isStreaming) return null;

  const getStepIcon = (name?: string) => {
    switch (name?.toLowerCase()) {
      case 'searching':
        return <Globe className="w-3.5 h-3.5 text-blue-400 animate-spin" />;
      case 'recalling':
        return <Database className="w-3.5 h-3.5 text-emerald-400" />;
      case 'reflecting':
        return <Brain className="w-3.5 h-3.5 text-purple-400" />;
      case 'planning':
      case 'synthesizing':
      default:
        return <Sparkles className="w-3.5 h-3.5 text-amber-400" />;
    }
  };

  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#18181B] border border-[#27272A] text-xs text-zinc-300 font-mono mb-2 shadow-sm">
      {getStepIcon(step?.step)}
      <span className="capitalize font-semibold text-zinc-200">{step?.step || 'Thinking'}</span>
      {step?.message && <span className="text-zinc-400 text-[11px]">— {step.message}</span>}
      {isStreaming && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse ml-0.5" />}
    </div>
  );
};

export const ReasoningBlock: React.FC<{ reasoning: string; isStreaming?: boolean }> = ({
  reasoning,
  isStreaming,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!reasoning.trim()) return null;

  return (
    <div className="mb-3 rounded-xl border border-[#27272A] bg-[#121214] overflow-hidden text-xs">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between w-full px-3 py-2 text-zinc-400 hover:text-zinc-200 hover:bg-[#1A1A1E] transition-colors"
      >
        <div className="flex items-center gap-1.5 font-mono">
          <Cpu className="w-3.5 h-3.5 text-zinc-400" />
          <span>Thought process</span>
          {isStreaming && <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping ml-1" />}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-zinc-500">{reasoning.length} chars</span>
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </div>
      </button>

      {isExpanded && (
        <div className="p-3 border-t border-[#27272A] bg-[#0E0E10] text-zinc-300 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap max-h-72 overflow-y-auto">
          {reasoning}
        </div>
      )}
    </div>
  );
};

export const ToolCallCard: React.FC<{ toolCall: ToolCallState }> = ({ toolCall }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const getIcon = () => {
    switch (toolCall.tool) {
      case 'tavily_search':
        return <Globe className="w-3.5 h-3.5 text-blue-400" />;
      case 'consult_memory':
        return <Database className="w-3.5 h-3.5 text-emerald-400" />;
      case 'read_mental_model':
        return <Brain className="w-3.5 h-3.5 text-purple-400" />;
      default:
        return <Cpu className="w-3.5 h-3.5 text-zinc-400" />;
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
    <div className="my-1.5 rounded-xl border border-[#27272A] bg-[#141417] text-xs font-mono overflow-hidden">
      <div
        onClick={() => toolCall.result && setIsExpanded(!isExpanded)}
        className={`flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-[#1C1C22] transition-colors ${
          !toolCall.result ? 'cursor-default' : ''
        }`}
      >
        <div className="flex items-center gap-2">
          {getIcon()}
          <span className="font-semibold text-zinc-200">{cleanToolName()}</span>
          {toolCall.query && (
            <span className="text-zinc-400 text-[11px] truncate max-w-xs sm:max-w-md">"{toolCall.query}"</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {toolCall.status === 'running' ? (
            <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          ) : (
            <span className="text-[10px] uppercase tracking-wider text-emerald-400 font-bold">Done</span>
          )}
          {toolCall.result && (
            isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-zinc-400" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
          )}
        </div>
      </div>

      {isExpanded && toolCall.result && (
        <div className="px-3 py-2.5 bg-[#0D0D10] border-t border-[#222226] text-[11px] text-zinc-300 whitespace-pre-wrap max-h-48 overflow-y-auto">
          {toolCall.result}
        </div>
      )}
    </div>
  );
};

export const CodeBlock: React.FC<{ language?: string; value: string }> = ({ language, value }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative my-3 rounded-xl border border-[#27272A] bg-[#0A0A0C] overflow-hidden text-xs">
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-[#141418] border-b border-[#222226] text-zinc-400 font-mono text-[11px]">
        <span>{language || 'text'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-[#24242C] text-zinc-300 hover:text-white transition-colors"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
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
