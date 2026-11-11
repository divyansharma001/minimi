// The web search tool: the agent's one tool.
//
// One call searches and reads. The model gets back a few numbered passages
// with their sources, never whole pages. The code that calls this gets the
// full saved copies too, so it can check quotes against them.
//
// Limits are set here, not left to the model: at most 3 searches and 8 pages
// per call. Searches and page reads run in parallel. A failed page or search
// is reported, never thrown, so one bad site cannot sink an answer.

import { todayIn } from "../memory/dates.ts";
import type { IsoDate } from "../memory/types.ts";
import { cleanPage } from "./clean.ts";
import { stripInjections } from "../guardrails/injection.ts";
import type { LinkGate } from "./link-gate.ts";
import { normalizeUrl } from "./link-gate.ts";
import { rankPassages, splitPassages, type PageForRanking } from "./passages.ts";
import type { Snapshot, SnapshotStore } from "./snapshots.ts";
import {
  FetchError,
  SearchError,
  type PageDate,
  type PageFetcher,
  type SearchBackend,
  type SearchHit,
} from "./types.ts";

export type WebSearchInput = {
  /** 1 to 3 search queries. */
  queries?: string[];
  /** Links to read directly, for example an old answer's sources. */
  open?: string[];
  /** Only search this site, for example "neon.com". */
  site?: string;
  /** "news" for recent articles, with `since` as the earliest day. */
  topic?: "general" | "news";
  since?: IsoDate;
};

export type Evidence = {
  url: string;
  title: string;
  heading: string;
  text: string;
  /** The saved copy this passage came from; missing if only a search snippet. */
  snapshotId?: string;
  readOn: IsoDate;
  pageDate?: PageDate;
  /** True when the page could not be read and only the search snippet is known. */
  snippetOnly: boolean;
  /** True when the site's name is in the search: likely the company's own site. */
  official?: boolean;
};

export type PageOutcome = "read" | "not-found" | "failed" | "blocked";

export type PageReport = { url: string; outcome: PageOutcome; detail?: string; snapshotId?: string };

export type WebSearchResult = {
  queries: string[];
  evidence: Evidence[];
  pages: PageReport[];
  /** Plain messages about searches or pages that went wrong. */
  problems: string[];
  /** Full saved copies of every page read, for code checks. Not for the model. */
  snapshots: Snapshot[];
};

export type WebSearchDeps = {
  backend: SearchBackend;
  fetcher: PageFetcher;
  gate: LinkGate;
  snapshots: SnapshotStore;
  now: () => Date;
  timeZone: string;
};

export const LIMITS = {
  queries: 3,
  open: 5,
  resultsPerQuery: 5,
  readPerQuery: 3,
  pages: 8,
  evidence: 10,
  perPage: 3,
  passageChars: 700,
  snippetsWhenUnread: 3,
} as const;

const isDay = (value: unknown): value is IsoDate =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));

function cleanInput(input: WebSearchInput) {
  const strings = (list: unknown, max: number, maxLength: number) =>
    (Array.isArray(list) ? list : [])
      .filter((q): q is string => typeof q === "string")
      .map((q) => q.trim().slice(0, maxLength))
      .filter((q) => q.length > 0)
      .filter((q, i, all) => all.indexOf(q) === i)
      .slice(0, max);
  return {
    queries: strings(input.queries, LIMITS.queries, 200),
    open: strings(input.open, LIMITS.open, 2000),
    site: typeof input.site === "string" && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(input.site.trim()) ? input.site.trim() : undefined,
    topic: input.topic === "news" ? ("news" as const) : ("general" as const),
    since: isDay(input.since) ? input.since : undefined,
  };
}

/**
 * Runs one tool call. `fromModel` is true when the model wrote the request,
 * so made-up links get the stricter link rule.
 */
export async function webSearch(rawInput: WebSearchInput, deps: WebSearchDeps, fromModel: boolean): Promise<WebSearchResult> {
  const input = cleanInput(rawInput);
  const now = deps.now();
  const today = todayIn(deps.timeZone, now);
  const problems: string[] = [];
  const pages: PageReport[] = [];

  // 1. Search, all queries at once.
  const searches = await Promise.allSettled(
    input.queries.map((q) =>
      deps.backend.search(q, {
        topic: input.topic,
        maxResults: LIMITS.resultsPerQuery,
        ...(input.site ? { site: input.site } : {}),
        ...(input.since ? { since: input.since } : {}),
      }),
    ),
  );
  const hitsPerQuery: SearchHit[][] = searches.map((s) => (s.status === "fulfilled" ? s.value : []));
  const searchErrors = new Set(
    searches.flatMap((s) =>
      s.status === "rejected" ? [s.reason instanceof SearchError ? s.reason.message : "A search failed."] : [],
    ),
  );
  problems.push(...searchErrors);
  deps.gate.remember(hitsPerQuery.flat().map((h) => h.url));

  // 2. Decide what to read: links asked for by name first, then the top hits.
  const toRead = new Map<string, { hit?: SearchHit; named: boolean }>();
  for (const raw of input.open) {
    const decision = deps.gate.check(raw, fromModel);
    if (!decision.ok) {
      pages.push({ url: raw, outcome: "blocked", detail: decision.reason });
      continue;
    }
    toRead.set(decision.url, { named: true });
  }
  for (const hits of hitsPerQuery) {
    for (const hit of hits.slice(0, LIMITS.readPerQuery)) {
      if (toRead.size >= LIMITS.pages) break;
      const decision = deps.gate.check(hit.url, false);
      if (!decision.ok) continue;
      const existing = toRead.get(decision.url);
      toRead.set(decision.url, { hit: existing?.hit ?? hit, named: existing?.named ?? false });
    }
  }

  // 3. Read every page at once, clean it, and save a dated copy.
  const reads = await Promise.all(
    [...toRead.entries()].map(async ([url, { hit, named }]) => {
      try {
        const raw = await deps.fetcher.fetch(url);
        const clean = cleanPage(raw);
        deps.gate.remember(clean.links);
        const pageDate =
          clean.pageDate ??
          (hit?.publishedOn ? { day: hit.publishedOn, kind: "published" as const, foundIn: "search-provider" as const } : undefined);
        const snapshot = await deps.snapshots.save({
          url,
          finalUrl: normalizeUrl(raw.finalUrl),
          day: today,
          fetchedAt: now.toISOString(),
          status: raw.status,
          title: clean.title,
          markdown: clean.markdown,
          ...(pageDate ? { pageDate } : {}),
        });
        const outcome: PageOutcome =
          raw.status === 404 || raw.status === 410 ? "not-found" : raw.status >= 400 ? "failed" : "read";
        return {
          url, hit, named, snapshot, outcome,
          detail: outcome === "read" ? undefined : `the site answered ${raw.status}`,
        };
      } catch (error) {
        const detail = error instanceof FetchError ? error.message : "the page could not be read";
        const outcome: PageOutcome = error instanceof FetchError && error.reason === "blocked" ? "blocked" : "failed";
        return { url, hit, named, snapshot: undefined, outcome, detail };
      }
    }),
  );

  for (const r of reads) {
    pages.push({
      url: r.url,
      outcome: r.outcome,
      ...(r.detail ? { detail: r.detail } : {}),
      ...(r.snapshot ? { snapshotId: r.snapshot.id } : {}),
    });
  }

  // 4. Pick the passages that answer the question.
  // The saved copy keeps the page as it was; the model only sees it with any
  // text aimed at an AI cut out.
  const readable = reads.filter((r) => r.outcome === "read" && r.snapshot);
  const forRanking: PageForRanking[] = readable.map((r) => {
    const { markdown, removed } = stripInjections(r.snapshot?.markdown ?? "");
    if (removed.length > 0) {
      problems.push(`Removed ${removed.length} passage(s) from ${r.url} that looked like instructions to an AI.`);
    }
    return {
      url: r.url,
      title: r.snapshot?.title ?? r.url,
      mustInclude: r.named,
      passages: splitPassages(markdown, LIMITS.passageChars),
    };
  });
  const question = [...input.queries, input.site ?? ""].join(" ");
  const ranked = rankPassages(question, forRanking, { total: LIMITS.evidence, perPage: LIMITS.perPage });

  const byUrl = new Map(readable.map((r) => [r.url, r.snapshot as Snapshot]));
  const evidence: Evidence[] = ranked.map((r) => {
    const snapshot = byUrl.get(r.url) as Snapshot;
    return {
      url: r.url,
      title: snapshot.title,
      heading: r.passage.heading,
      text: r.passage.text,
      snapshotId: snapshot.id,
      readOn: snapshot.day,
      ...(snapshot.pageDate ? { pageDate: snapshot.pageDate } : {}),
      snippetOnly: false,
      ...(r.official ? { official: true } : {}),
    };
  });

  // Pages that could not be read still have a search snippet. It is weaker
  // evidence, so it is marked, and only a few are kept.
  const unread = reads.filter((r) => r.outcome === "failed" && r.hit?.snippet);
  for (const r of unread.slice(0, LIMITS.snippetsWhenUnread)) {
    evidence.push({
      url: r.url,
      title: r.hit?.title ?? r.url,
      heading: "",
      text: r.hit?.snippet ?? "",
      readOn: today,
      ...(r.hit?.publishedOn
        ? { pageDate: { day: r.hit.publishedOn, kind: "published" as const, foundIn: "search-provider" as const } }
        : {}),
      snippetOnly: true,
    });
  }

  return {
    queries: input.queries,
    evidence,
    pages,
    problems,
    snapshots: reads.flatMap((r) => (r.snapshot ? [r.snapshot] : [])),
  };
}
