import React, { useState, useEffect, useRef } from 'react';
import type { FC } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  FileText,
  Download,
  Copy,
  Check,
  Maximize2,
  Minimize2,
  X,
  ExternalLink,
} from 'lucide-react';
import type { Artifact } from '../types';
import { getArtifactPdfUrl } from '../api';
import { CodeBlock } from './CognitiveWidgets';

interface ArtifactCanvasProps {
  artifact: Artifact | null;
  isOpen: boolean;
  onClose: () => void;
  width?: number;
  onWidthChange?: (width: number) => void;
}

export const ArtifactCanvas: FC<ArtifactCanvasProps> = ({
  artifact,
  isOpen,
  onClose,
  width = 620,
  onWidthChange,
}) => {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartXRef = useRef<number>(0);
  const dragStartWidthRef = useRef<number>(width);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = dragStartXRef.current - e.clientX;
      const newWidth = Math.max(420, Math.min(1000, dragStartWidthRef.current + deltaX));
      onWidthChange?.(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, onWidthChange]);

  const handleStartResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const handleCopyMarkdown = () => {
    if (!artifact) return;
    navigator.clipboard.writeText(artifact.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadPdf = () => {
    if (!artifact) return;
    const url = getArtifactPdfUrl(artifact.id);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${artifact.title.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (!isOpen || !artifact) return null;

  const typeBadge = (artifact.artifact_type || 'document').replace(/_/g, ' ').toUpperCase();

  return (
    <div
      className={
        isExpanded
          ? 'fixed inset-0 z-50 flex flex-col bg-black'
          : 'relative flex flex-col h-full bg-black shrink-0 shadow-2xl transition-all duration-150'
      }
      style={{
        width: isExpanded ? '100vw' : `${width}px`,
        maxWidth: isExpanded ? '100vw' : '80vw',
        minWidth: isExpanded ? undefined : '380px',
      }}
    >
      {/* Resizer Handle */}
      {!isExpanded && (
        <div
          onMouseDown={handleStartResize}
          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-sky-500/40 transition-colors z-50 group flex items-center justify-center -translate-x-1"
          title="Drag to resize panel"
        >
          <div className="w-0.5 h-8 rounded-full bg-neutral-700 group-hover:bg-sky-400 transition-colors" />
        </div>
      )}

      {/* Top Action & Navigation Bar */}
      <div className="flex items-center justify-between px-5 py-3.5 bg-black select-none shrink-0">
        <div className="flex items-center gap-2.5 min-w-0 pr-3">
          <div className="p-1.5 rounded-xl bg-[#141416] text-rose-400 shrink-0">
            <FileText className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#18181b] text-neutral-400">
                {typeBadge}
              </span>
              <span className="text-[11px] font-mono text-neutral-500">
                v{artifact.version}
              </span>
            </div>
            <h3 className="text-sm font-semibold text-white truncate tracking-tight mt-0.5">
              {artifact.title}
            </h3>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Copy Raw Markdown */}
          <button
            type="button"
            onClick={handleCopyMarkdown}
            title="Copy Markdown"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#141416] hover:bg-[#1c1c20] text-neutral-300 text-xs font-medium transition-colors"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>

          {/* Export / Download PDF */}
          <button
            type="button"
            onClick={handleDownloadPdf}
            title="Download PDF"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-neutral-200 text-black text-xs font-semibold shadow-sm transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>PDF</span>
          </button>

          {/* Expand / Collapse Full Width */}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? 'Restore split view' : 'Maximize canvas'}
            className="p-1.5 rounded-xl text-neutral-400 hover:text-white hover:bg-[#141416] transition-colors ml-1"
          >
            {isExpanded ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </button>

          {/* Close Panel */}
          <button
            type="button"
            onClick={onClose}
            title="Close canvas"
            className="p-1.5 rounded-xl text-neutral-400 hover:text-white hover:bg-[#141416] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Document Content Canvas */}
      <div className="flex-1 overflow-y-auto px-6 sm:px-10 py-6 custom-scrollbar bg-black">
        <div className="max-w-3xl mx-auto">
          {/* Header Title Block */}
          <div className="mb-6 pb-4">
            <div className="flex items-center gap-2 mb-2 text-xs font-mono text-neutral-500 uppercase tracking-wider">
              <span>{typeBadge}</span>
              <span>-</span>
              <span>VERSION {artifact.version}</span>
              {artifact.created_at && (
                <>
                  <span>-</span>
                  <span>{new Date(artifact.created_at).toLocaleDateString()}</span>
                </>
              )}
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white leading-snug">
              {artifact.title}
            </h1>
            {artifact.summary && (
              <p className="mt-3 text-sm text-neutral-400 leading-relaxed font-normal">
                {artifact.summary}
              </p>
            )}
          </div>

          {/* Markdown Body Viewer */}
          <div className="text-neutral-200 text-[15px] leading-relaxed font-normal selection:bg-neutral-800">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1({ children }) {
                  return (
                    <h1 className="text-xl sm:text-2xl font-bold text-white mt-8 mb-3 tracking-tight">
                      {children}
                    </h1>
                  );
                },
                h2({ children }) {
                  return (
                    <h2 className="text-lg sm:text-xl font-semibold text-white mt-7 mb-2.5 tracking-tight">
                      {children}
                    </h2>
                  );
                },
                h3({ children }) {
                  return (
                    <h3 className="text-base sm:text-lg font-semibold text-neutral-200 mt-5 mb-2 tracking-tight">
                      {children}
                    </h3>
                  );
                },
                p({ children }) {
                  return <p className="my-3 text-neutral-300 leading-relaxed">{children}</p>;
                },
                ul({ children }) {
                  return (
                    <ul className="list-disc pl-5 my-3 space-y-1.5 text-neutral-300 marker:text-neutral-500">
                      {children}
                    </ul>
                  );
                },
                ol({ children }) {
                  return (
                    <ol className="list-decimal pl-5 my-3 space-y-1.5 text-neutral-300 marker:text-neutral-500">
                      {children}
                    </ol>
                  );
                },
                li({ children }) {
                  return <li className="pl-1 leading-relaxed">{children}</li>;
                },
                blockquote({ children }) {
                  return (
                    <blockquote className="border-l-2 border-neutral-700 pl-4 py-1 my-4 text-neutral-400 italic">
                      {children}
                    </blockquote>
                  );
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
                      className="px-1.5 py-0.5 rounded font-mono text-[13.5px] font-medium text-rose-300 bg-[#18181b]"
                      {...props}
                    >
                      {children}
                    </code>
                  );
                },
                a({ href, children }) {
                  return (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sky-400 hover:text-sky-300 underline underline-offset-4 inline-flex items-center gap-1 transition-colors"
                    >
                      {children}
                      <ExternalLink className="w-3 h-3 inline opacity-70" />
                    </a>
                  );
                },
              }}
            >
              {artifact.content}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
};
