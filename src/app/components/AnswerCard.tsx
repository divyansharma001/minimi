"use client";

import { ArrowRightLeft, Check, ChevronDown, CircleHelp, ExternalLink, Undo2 } from "lucide-react";
import type { ClaimStatus } from "@/memory/types.ts";
import type { ClaimView, MessageView, SourceView } from "../view.ts";
import { Markdown } from "./Markdown.tsx";
import { shortDay } from "./dates.ts";

const STATUS: Record<ClaimStatus, { label: string; tone: string; Icon: typeof Check }> = {
  supported: { label: "Checked", tone: "pill-checked", Icon: Check },
  same: { label: "Still true", tone: "pill-checked", Icon: Check },
  changed: { label: "Changed", tone: "pill-changed", Icon: ArrowRightLeft },
  "was-wrong": { label: "Was wrong", tone: "pill-wrong", Icon: Undo2 },
  "cannot-confirm": { label: "Couldn't confirm", tone: "pill-unknown", Icon: CircleHelp },
};

function StatusPill({ status }: { status: ClaimStatus }) {
  const { label, tone, Icon } = STATUS[status];
  return (
    <span className={`pill ${tone}`}>
      <Icon size={15} strokeWidth={2.4} aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * How many facts have each status, in the order of STATUS, for the closed
 * dropdown: "12 checked, 1 changed" says whether to open it.
 */
function tally(claims: ClaimView[]) {
  return (Object.keys(STATUS) as ClaimStatus[])
    .map((status) => ({ status, count: claims.filter((c) => c.status === status).length }))
    .filter((t) => t.count > 0);
}

/**
 * Prices, amounts and dates in a fact get weight 600, so each row reads like
 * the reference card's label and value: a grey sentence, a bold figure.
 */
const VALUE = /((?:[$₹€£]\s?)?\d[\d,]*(?:\.\d+)?(?:\s?%|\s?(?:per|\/)\s?[A-Za-z-]+(?:-[A-Za-z]+)?|\/mo\b)?)/g;

function withValues(text: string) {
  return text.split(VALUE).map((part, i) =>
    i % 2 === 1 ? (
      <strong className="fact-value" key={i}>
        {part}
      </strong>
    ) : (
      part
    ),
  );
}

function Fact({ claim, anchor, index, page }: { claim: ClaimView; anchor: string; index: number; page?: number }) {
  return (
    <li className="fact" style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}>
      <div className="fact-text">{withValues(claim.text)}</div>
      {claim.site && (
        <div className="fact-meta">
            {page !== undefined && (
              <a className="cite" href={`#${anchor}-${page}`} aria-label={`Source ${page}`}>
                {page}
              </a>
            )}
          <span>{claim.site}</span>
          <span aria-hidden="true">·</span>
          <span>read {shortDay(claim.readOn)}</span>
        </div>
      )}
      <StatusPill status={claim.status} />
    </li>
  );
}

function Source({ source, anchor, page }: { source: SourceView; anchor: string; page: number }) {
  const pageDate = source.pageDay ? ` · page dated ${shortDay(source.pageDay)}` : "";
  return (
    <li className="source" id={`${anchor}-${page}`}>
      <span className="cite" aria-hidden="true">
        {page}
      </span>
      <div className="source-body">
        <a href={source.url} target="_blank" rel="noopener noreferrer nofollow">
          <span>{source.title || source.site}</span>
          <ExternalLink size={14} aria-hidden="true" />
        </a>
        <div className="source-meta">
          {source.site} · read {shortDay(source.readOn)}
          {pageDate}
        </div>
      </div>
    </li>
  );
}

/**
 * Evidence is numbered by passage, so one page can hold several numbers.
 * Readers think in pages: number each page once, in order of first citation,
 * and map every passage number to its page.
 */
function byPage(sources: SourceView[]) {
  const pages: SourceView[] = [];
  const pageOfUrl = new Map<string, number>();
  for (const source of [...sources].sort((a, b) => a.n - b.n)) {
    if (!pageOfUrl.has(source.url)) {
      pages.push(source);
      pageOfUrl.set(source.url, pages.length);
    }
  }
  const pageOfN = new Map(sources.map((s) => [s.n, pageOfUrl.get(s.url) as number]));
  return { pages, pageOfUrl, pageOf: (n: number) => pageOfN.get(n) };
}

export function AnswerCard({ message }: { message: MessageView }) {
  const anchor = `src-${message.id}`;
  const claims = message.answer?.claims ?? [];
  const { pages, pageOfUrl, pageOf } = byPage(message.answer?.sources ?? []);
  return (
    <article className="card" aria-label="Answer">
      <Markdown text={message.text} anchor={anchor} pageOf={pageOf} />
      {claims.length > 0 && (
        <details className="facts-box">
          <summary>
            <span className="facts-title">
              Checked facts <span className="facts-count">{claims.length}</span>
            </span>
            <span className="tallies">
              {tally(claims).map(({ status, count }) => (
                <span className={`tally ${STATUS[status].tone}`} key={status}>
                  {count} {STATUS[status].label.toLowerCase()}
                </span>
              ))}
            </span>
            <ChevronDown className="chevron" size={18} aria-hidden="true" />
          </summary>
          <ul className="facts">
            {claims.map((claim, i) => (
              <Fact claim={claim} anchor={anchor} index={i} page={pageOfUrl.get(claim.url)} key={`${claim.text}-${i}`} />
            ))}
          </ul>
        </details>
      )}
      {pages.length > 0 && (
        <>
          <h2 className="section-label">Sources</h2>
          <ol className="sources">
            {pages.map((source, i) => (
              <Source source={source} anchor={anchor} page={i + 1} key={source.url} />
            ))}
          </ol>
        </>
      )}
    </article>
  );
}
