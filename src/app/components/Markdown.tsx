"use client";

// Renders an answer's Markdown safely.
// - Raw HTML in the text is dropped (skipHtml), never rendered.
// - Links are only followed when they are http(s); anything else is removed.
// - [n] citation markers become small chips that jump to source n below.

import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const CITE = "cite:";

/**
 * "[2]" becomes a link to "cite:<page>", unless it is already a Markdown link.
 * Evidence is numbered by passage, so one page can carry several numbers;
 * `pageOf` turns each into its page's number, and a run like "[4][6]" that
 * points at one page shows one chip.
 */
function withCitations(text: string, pageOf: (n: number) => number | undefined): string {
  return text.replace(/(?:\[\d{1,3}\](?!\())+/g, (run) => {
    const pages = [...run.matchAll(/\d{1,3}/g)].map((m) => pageOf(Number(m[0]))).filter((p): p is number => p !== undefined);
    return [...new Set(pages)].map((p) => `[${p}](${CITE}${p})`).join("");
  });
}

function urlTransform(url: string): string {
  if (url.startsWith(CITE)) return url;
  const safe = defaultUrlTransform(url);
  return /^https?:\/\//i.test(safe) ? safe : "";
}

type Props = { text: string; anchor: string; pageOf: (n: number) => number | undefined };

export function Markdown({ text, anchor, pageOf }: Props) {
  const components: Components = {
    a({ href, children }) {
      if (href?.startsWith(CITE)) {
        const n = href.slice(CITE.length);
        return (
          <a className="cite" href={`#${anchor}-${n}`} aria-label={`Source ${n}`}>
            {n}
          </a>
        );
      }
      if (!href) return <>{children}</>;
      return (
        <a href={href} target="_blank" rel="noopener noreferrer nofollow">
          {children}
        </a>
      );
    },
    table({ children }) {
      return (
        <div className="table-wrap">
          <table>{children}</table>
        </div>
      );
    },
    img() {
      return null;
    },
  };

  return (
    <div className="prose">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={urlTransform} components={components}>
        {withCitations(text, pageOf)}
      </ReactMarkdown>
    </div>
  );
}
