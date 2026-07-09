import { isValidElement, ReactNode } from "react";
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
};

export function MarkdownRenderer({
  markdown,
  className = "",
  emptyText = "暂无内容。",
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
          pre: ({ children }) => (
            <pre data-language={extractCodeLanguage(children)}>
              {children}
            </pre>
          ),
          img: ({ alt, src }) => <img alt={alt ?? ""} src={src ?? ""} loading="lazy" />,
        }}
      >
        {value}
      </ReactMarkdown>
    </div>
  );
}

function extractCodeLanguage(children: ReactNode) {
  const child = Array.isArray(children) ? children.find(isValidElement) : children;
  if (!isValidElement<{ className?: string }>(child)) return "code";
  const className = child.props.className ?? "";
  return className.match(/language-([\w-]+)/)?.[1] ?? "code";
}
