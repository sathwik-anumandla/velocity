import React, { useState, useEffect, useRef } from 'react';
import type { FC } from 'react';
import {
  FileCode2,
  Download,
  Copy,
  Check,
  Maximize2,
  Minimize2,
  X,
  Menu,
  Share2,
  Palette,
  ChevronLeft,
} from 'lucide-react';
import type { Artifact } from '../types';
import { getArtifactPdfUrl, updateArtifactTheme } from '../api';
import { MarkdownContent } from './MarkdownContent';

interface ArtifactCanvasProps {
  artifact: Artifact | null;
  isOpen: boolean;
  onClose: () => void;
  width?: number;
  onWidthChange?: (width: number) => void;
  onUpdate?: (artifact: Artifact) => void;
}

export const ArtifactCanvas: FC<ArtifactCanvasProps> = ({
  artifact,
  isOpen,
  onClose,
  width = 620,
  onWidthChange,
  onUpdate,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const themes = [['midnight', 'Midnight'], ['editorial', 'Editorial'], ['clean', 'Clean'], ['technical', 'Technical Light'], ['technical-dark', 'Technical Dark']];
  const dismissMenu = () => {
    setMenuOpen(false);
    setAppearanceOpen(false);
    menuButtonRef.current?.focus();
  };
  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[data-document-action]')?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) {
        setMenuOpen(false);
        setAppearanceOpen(false);
      }
    };
    window.addEventListener('pointerdown', outside);
    return () => window.removeEventListener('pointerdown', outside);
  }, [menuOpen, appearanceOpen]);
  const [savingAppearance, setSavingAppearance] = useState(false);
  const [appearanceError, setAppearanceError] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const saveAppearance = async (theme: string) => {
    if (!artifact || savingAppearance) return;
    setSavingAppearance(true);
    setAppearanceError(null);
    try { onUpdate?.(await updateArtifactTheme(artifact.id, theme)); }
    catch (error) { setAppearanceError(error instanceof Error ? error.message : 'Could not save appearance'); }
    finally { setSavingAppearance(false); }
  };
  const [copyFeedback, setCopyFeedback] = useState<{ id: string; version: number; error?: string } | null>(null);
  const activeFeedback = copyFeedback?.id === artifact?.id && copyFeedback?.version === artifact?.version ? copyFeedback : null;
  const copied = Boolean(activeFeedback && !activeFeedback.error);
  const copyError = activeFeedback?.error;
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartXRef = useRef<number>(0);
  const dragStartWidthRef = useRef<number>(width);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        if (menuOpen) dismissMenu();
        else onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, menuOpen]);

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

  useEffect(() => {
    if (!copyFeedback || copyFeedback.error) return;
    const timer = window.setTimeout(() => setCopyFeedback(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copyFeedback]);

  const handleCopyMarkdown = async () => {
    if (!artifact) return;
    try {
      await navigator.clipboard.writeText(artifact.content);
      setCopyFeedback({ id: artifact.id, version: artifact.version });
    } catch {
      setCopyFeedback({ id: artifact.id, version: artifact.version, error: 'Copy unavailable. Select the document text to copy it manually.' });
    }
  };

  const handleDownloadPdf = async () => {
    if (!artifact || exportingPdf || savingAppearance) return;
    setExportingPdf(true);
    setAppearanceError(null);
    try {
      const response = await fetch(getArtifactPdfUrl(artifact.id));
      if (!response.ok) throw new Error('PDF export failed. Your document is unchanged; try again.');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${artifact.title.toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'document'}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (error) {
      setAppearanceError(error instanceof Error ? error.message : 'PDF export failed');
    } finally { setExportingPdf(false); }
  };

  const handleShare = async () => {
    if (!artifact) return;
    try {
      if (navigator.share) await navigator.share({ title: artifact.title, text: artifact.content });
      else await handleCopyMarkdown();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setAppearanceError('Sharing unavailable. Use Copy to share the document text.');
      }
    }
  };

  if (!isOpen || !artifact) return null;

  const typeBadge = (artifact.artifact_type || 'document').replace(/_/g, ' ').toUpperCase();

  return (
    <div
      className={
        isExpanded
          ? 'artifact-canvas fixed inset-0 z-50 flex flex-col bg-[var(--bg-primary)]'
          : 'artifact-canvas relative flex flex-col h-full bg-[var(--bg-primary)] shrink-0 shadow-2xl transition-all duration-150'
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
          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-[var(--accent-soft)] transition-colors z-50 group flex items-center justify-center -translate-x-1"
          title="Drag to resize panel"
        >
          <div className="w-0.5 h-8 rounded-full bg-[var(--bg-pill-hover)] group-hover:bg-[var(--accent-soft)] transition-colors" />
        </div>
      )}

      {/* Top Action & Navigation Bar */}
      <div className="flex items-center justify-between px-5 py-3.5 bg-[var(--bg-primary)] select-none shrink-0">
        <div className="flex items-center gap-2.5 min-w-0 pr-3">
          <div className="p-1.5 text-[var(--text-muted)] shrink-0">
            <FileCode2 className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate tracking-tight">
              {artifact.title}
            </h3>
          </div>
        </div>


        <div className="flex items-center gap-1 shrink-0">
          <div ref={menuRef} className="relative">
            <button ref={menuButtonRef} type="button" aria-label="Document options" aria-expanded={menuOpen} aria-controls="document-options"
              onClick={() => { setMenuOpen(!menuOpen); setAppearanceOpen(false); }}
              className="p-2 rounded-xl text-[var(--text-muted)] hover:bg-[var(--bg-card)]">
              <Menu className="w-5 h-5" />
            </button>
            {menuOpen && (
              <div id="document-options" aria-label="Document options" className="absolute right-0 top-full mt-2 z-50 w-60 rounded-2xl border border-[var(--bg-pill)] bg-[var(--bg-primary)] p-2 shadow-xl text-sm text-[var(--text-primary)]">
                {appearanceOpen ? (
                  <>
                    <button data-document-action type="button" onClick={() => setAppearanceOpen(false)} className="flex items-center gap-3 w-full p-3 rounded-xl hover:bg-[var(--bg-card)]">
                      <ChevronLeft className="w-4 h-4" /> Appearance
                    </button>
                    <p className="px-3 pb-2 text-xs text-[var(--text-muted)]">Also applies to PDF exports</p>
                    {themes.map(([theme, label]) => (
                      <button key={theme} type="button" aria-pressed={(artifact.theme || 'midnight') === theme} disabled={savingAppearance || exportingPdf}
                        onClick={() => { dismissMenu(); void saveAppearance(theme); }}
                        className="flex items-center justify-between w-full p-3 rounded-xl hover:bg-[var(--bg-card)] disabled:opacity-50">
                        {label}{(artifact.theme || 'midnight') === theme && <Check className="w-4 h-4 text-[var(--accent)]" />}
                      </button>
                    ))}
                  </>
                ) : (
                  <>
                    <button data-document-action type="button" onClick={() => setAppearanceOpen(true)} className="flex items-center gap-3 w-full p-3 rounded-xl hover:bg-[var(--bg-card)]"><Palette className="w-4 h-4" /> Appearance</button>
                    <button type="button" onClick={() => { dismissMenu(); void handleCopyMarkdown(); }} className="flex items-center gap-3 w-full p-3 rounded-xl hover:bg-[var(--bg-card)]"><Copy className="w-4 h-4" /> Copy Markdown</button>
                    <button type="button" onClick={() => { dismissMenu(); void handleShare(); }} className="flex items-center gap-3 w-full p-3 rounded-xl hover:bg-[var(--bg-card)]"><Share2 className="w-4 h-4" /> Share</button>
                    <button type="button" disabled={exportingPdf || savingAppearance} onClick={() => { dismissMenu(); void handleDownloadPdf(); }} className="flex items-center gap-3 w-full p-3 rounded-xl hover:bg-[var(--bg-card)] disabled:opacity-50"><Download className="w-4 h-4" /> Export PDF</button>
                    <button type="button" onClick={() => { dismissMenu(); setIsExpanded(!isExpanded); }} className="flex items-center gap-3 w-full p-3 rounded-xl hover:bg-[var(--bg-card)]">
                      {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}{isExpanded ? 'Restore split view' : 'Full screen'}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close document" className="p-2 rounded-xl text-[var(--text-muted)] hover:bg-[var(--bg-card)]"><X className="w-5 h-5" /></button>
        </div>
      </div>
      {(copyError || appearanceError) && <p role="alert" className="px-5 py-2 text-xs text-[var(--text-secondary)]">{copyError || appearanceError}</p>}
      {(copied || savingAppearance || exportingPdf) && <p role="status" className="px-5 py-2 text-xs text-[var(--text-muted)]">{exportingPdf ? 'Exporting PDF…' : savingAppearance ? 'Saving appearance…' : 'Document copied'}</p>}
      <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-5 custom-scrollbar bg-[var(--bg-sidebar)]">
        <article data-theme={artifact.theme || 'midnight'} className="document-paper max-w-3xl mx-auto rounded-2xl px-5 sm:px-10 py-8 sm:py-10 shadow-sm">
          {/* Header Title Block */}
          <div className="mb-8 pb-6 border-b border-[var(--bg-pill)]">
            <div className="flex flex-wrap items-center gap-2 mb-4 text-[11px] text-[var(--text-muted)] tracking-wide">
              <span>{typeBadge}</span>
              <span>-</span>
              <span>VERSION {artifact.version}</span>
              <span>·</span>
              <span>{Math.max(1, Math.ceil(artifact.content.trim().split(/\s+/).filter(Boolean).length / 220))} min read</span>
              {artifact.created_at && (
                <>
                  <span>-</span>
                  <span>{new Date(artifact.created_at).toLocaleDateString()}</span>
                </>
              )}
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text-primary)] leading-snug">
              {artifact.title}
            </h1>
            {artifact.summary && (
              <p className="mt-3 text-sm text-[var(--text-muted)] leading-relaxed font-normal">
                {artifact.summary}
              </p>
            )}
          </div>

          {/* Markdown Body Viewer */}
          <div className="text-[var(--text-secondary)] text-[15px] leading-relaxed font-normal selection:bg-[var(--bg-pill)]">
            <MarkdownContent>{artifact.content}</MarkdownContent>
          </div>
        </article>
      </div>
    </div>
  );
};
