import { Check, CopySimple } from "@phosphor-icons/react";
import { isValidElement, ReactNode, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";

type MarkdownRendererProps = {
  markdown: string;
  className?: string;
  emptyText?: string;
  highlightCitations?: boolean;
};

export function MarkdownRenderer({
  markdown,
  className = "",
  emptyText = "暂无内容。",
  highlightCitations = false,
}: MarkdownRendererProps) {
  const value = markdown.trim() ? markdown : emptyText;

  return (
    <div className={`markdown-renderer ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, [rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          li: ({ children }) => <li>{renderCitationRefs(children, highlightCitations)}</li>,
          p: ({ children }) => <p>{renderCitationRefs(children, highlightCitations)}</p>,
          pre: ({ children }) => (
            <CodeBlock language={extractCodeLanguage(children)} code={extractCodeText(children)}>
              {children}
            </CodeBlock>
          ),
          img: ({ alt, src }) => <img alt={alt ?? ""} src={src ?? ""} loading="lazy" />,
        }}
      >
        {value}
      </ReactMarkdown>
    </div>
  );
}

function CodeBlock({
  children,
  code,
  language,
}: {
  children: ReactNode;
  code: string;
  language: string;
}) {
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    if (!code.trim()) return;
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="markdown-code-shell" data-language={language}>
      <button className="markdown-code-copy" onClick={copyCode} type="button">
        {copied ? <Check size={13} /> : <CopySimple size={13} />}
        {copied ? "已复制" : "复制"}
      </button>
      <pre>{children}</pre>
    </div>
  );
}

function extractCodeLanguage(children: ReactNode) {
  const child = Array.isArray(children) ? children.find(isValidElement) : children;
  if (!isValidElement<{ className?: string }>(child)) return "code";
  const className = child.props.className ?? "";
  return className.match(/language-([\w-]+)/)?.[1] ?? "code";
}

function extractCodeText(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(extractCodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(children)) return extractCodeText(children.props.children);
  return "";
}

function renderCitationRefs(children: ReactNode, enabled: boolean): ReactNode {
  if (!enabled) return children;
  if (typeof children === "string") return highlightCitationString(children);
  if (typeof children === "number") return children;
  if (Array.isArray(children)) {
    return children.map((child, index) => (
      <span key={index}>{renderCitationRefs(child, enabled)}</span>
    ));
  }
  return children;
}

function highlightCitationString(value: string): ReactNode {
  const parts = value.split(/(\[\d{1,2}\])/g);
  if (parts.length === 1) return value;
  return parts.map((part, index) => {
    const match = part.match(/^\[(\d{1,2})\]$/);
    if (!match) return part;
    return (
      <span className="citation-ref" key={`${part}-${index}`}>
        {part}
      </span>
    );
  });
}
