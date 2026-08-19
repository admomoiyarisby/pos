import { useMemo } from "react";
import { marked } from "marked";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

// Configure marked for clean output
marked.setOptions({
  gfm: true,
  breaks: false,
});

export function MarkdownRenderer({ content, className = "" }: MarkdownRendererProps) {
  const html = useMemo(() => {
    const result = marked.parse(content);
    // Handle both sync and async marked.parse
    if (result instanceof Promise) {
      return "";
    }
    return result;
  }, [content]);

  return <div className={`prose-docs ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
