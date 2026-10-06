import { isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './CognitiveWidgets';

export function MarkdownContent({ children }: { children: string }) {
  return <div className="velocity-markdown min-w-0">
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
      pre({ children: code }) {
        const element = (Array.isArray(code) ? code[0] : code) as ReactElement<{ className?: string; children?: ReactNode }>;
        if (!isValidElement(element)) return <pre>{code}</pre>;
        const language = /language-([^\s]+)/.exec(element.props.className || '')?.[1] || 'text';
        return <CodeBlock language={language} value={String(element.props.children || '').replace(/\n$/, '')} />;
      },
      code({ children: code }) { return <code className="inline-code">{code}</code>; },
      table({ children: rows }) { return <div className="markdown-table"><table>{rows}</table></div>; },
      a({ href, children: label }) { return <a href={href} target="_blank" rel="noopener noreferrer">{label}</a>; },
      img({ src, alt }) { return <img src={src} alt={alt || ''} loading="lazy" referrerPolicy="no-referrer" />; },
    }}>{children}</ReactMarkdown>
  </div>;
}
