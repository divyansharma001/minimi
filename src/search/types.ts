// Shapes for the web search tool. This folder is a module of its own: it
// knows nothing about chats or memory, so other agents can reuse it as is.

import type { IsoDate } from "../memory/types.ts";

/** One result from a search provider: where a page is, not what it says. */
export type SearchHit = {
  url: string;
  title: string;
  snippet: string;
  publishedOn?: IsoDate;
};

export type SearchOptions = {
  /** "news" asks for recent articles with dates; "general" for anything. */
  topic: "general" | "news";
  /** For news: only articles from this day on. */
  since?: IsoDate;
  /** Only results from this site, for example "basalt.example". */
  site?: string;
  maxResults: number;
};

/** Finds pages. Tavily in the app, the fake web in tests. */
export interface SearchBackend {
  search(query: string, options: SearchOptions): Promise<SearchHit[]>;
}

/** A downloaded page, before cleaning. */
export type RawPage = {
  url: string;
  /** Where the page really came from, after redirects. */
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
};

/** Reads pages. A safe HTTP client in the app, the fake web in tests. */
export interface PageFetcher {
  fetch(url: string): Promise<RawPage>;
}

export type FetchFailure = "blocked" | "timeout" | "too-large" | "not-text" | "http-error" | "network";

export class FetchError extends Error {
  readonly reason: FetchFailure;

  constructor(reason: FetchFailure, message: string) {
    super(message);
    this.reason = reason;
  }
}

export type SearchFailure = "auth" | "quota" | "rate-limit" | "provider";

export class SearchError extends Error {
  readonly reason: SearchFailure;

  constructor(reason: SearchFailure, message: string) {
    super(message);
    this.reason = reason;
  }
}

/** A date printed on a page, and where it was found. Often missing or wrong. */
export type PageDate = {
  day: IsoDate;
  kind: "published" | "updated";
  foundIn: "page-meta" | "search-provider";
};
