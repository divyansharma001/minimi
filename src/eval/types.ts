// Shapes shared by the test set, the fake web and the scorer.
//
// The agent is scored on a Trace: a structured record of what it did.
// Code cannot reliably judge prose ("did it admit it had no record?"),
// but it can judge "recalledChatIds is empty". So the agent must report
// its work in this shape, and the scorer reads it.

import type { ClaimStatus, IsoDate } from "../memory/types.ts";

export type { ClaimStatus, IsoDate };

// ---------- Past chats (what the user and the agent said before) ----------

export type PastClaim = {
  /** What the agent told the user. Not a fact: it may have been wrong. */
  text: string;
  /** The exact words on the source page the claim was based on. */
  quote: string;
  url: string;
  /** The day the page copy was saved. */
  capturedOn: IsoDate;
};

export type PastChat = {
  id: string;
  date: IsoDate;
  topic: string;
  userMessage: string;
  answer: string;
  claims: PastClaim[];
};

// ---------- The fake web ----------

export type PageVersion = {
  /** This version is what the page showed from this day on. */
  from: IsoDate;
  /** 200 for a normal page, 404 for a page that no longer exists. */
  status: 200 | 404;
  title: string;
  /** Page text as Markdown, the way the cleaner will see it. */
  markdown: string;
  /** Date printed on the page, if any. Often missing on real sites. */
  publishedOn?: IsoDate;
};

export type FixturePage = {
  url: string;
  versions: PageVersion[];
};

// ---------- What the agent reports ----------

export type TraceClaim = {
  text: string;
  quote: string;
  url: string;
  status: ClaimStatus;
};

export type Trace = {
  /** Dates the agent took the user's words to mean, best guess first. */
  resolvedDates: IsoDate[];
  /** Past chats the agent loaded into its prompt. */
  recalledChatIds: string[];
  /** Every search query the agent ran, in order. */
  searchQueries: string[];
  /** Every page the agent read (or found gone), by search or by name. */
  pagesRead: string[];
  claims: TraceClaim[];
  /** True when the safety check stopped the agent from answering. */
  refused: boolean;
  /** The text the user sees. */
  answer: string;
  timings: { totalMs: number; firstTextMs: number | null };
};

// ---------- One test case ----------

/**
 * "required": the agent must check the web (search, or re-read a source)
 * instead of answering from memory. "forbidden": it must not touch the web.
 */
export type SearchExpectation = "required" | "forbidden" | "optional";

export type EvalCase = {
  id: string;
  /** Why this case exists, in one line. */
  purpose: string;
  /** Earlier turns in the same chat, for follow-up questions. */
  earlierTurns?: { role: "user" | "assistant"; text: string }[];
  question: string;
  expect: {
    /** Every one of these dates must be among the resolved dates. */
    resolvedDates?: IsoDate[];
    /** Every one of these chats must be recalled. Empty list: recall nothing. */
    recall?: string[];
    /** None of these chats may be recalled. */
    notRecall?: string[];
    search: SearchExpectation;
    /** At least this many different search queries (fan-out). */
    minQueries?: number;
    /** Each must appear in the answer, ignoring case. */
    mention?: string[];
    /** None may appear in the answer, ignoring case. */
    notMention?: string[];
    /** A claim with this URL must exist with this status. */
    claims?: { url: string; status: ClaimStatus }[];
    /** Should the safety check stop the answer? Every case checks this; the default is no. */
    refused?: boolean;
  };
  /** Things code cannot check, for a person reading the run. */
  reviewNotes?: string;
};
