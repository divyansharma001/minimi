// The records the agent keeps. Three kinds, kept apart on purpose:
// - what the user said (chat turns, role "user")
// - what the agent answered (answer records with claims): never treated as fact
// - what sources said (saved page copies, added in step 4): the only facts

/** A calendar day in the user's time zone, written YYYY-MM-DD. */
export type IsoDate = string;

export type ClaimStatus =
  | "supported" // a new fact, backed by its quote
  | "same" // an old claim that still holds today
  | "changed" // an old claim that held then, but the source has changed since
  | "was-wrong" // an old claim its own saved source never supported
  | "cannot-confirm"; // no source could settle it

export type Turn = {
  role: "user" | "assistant";
  text: string;
  /** Exact time, as an ISO timestamp in UTC. */
  at: string;
  /**
   * The user's calendar day when the turn happened. Stored, not recomputed,
   * so "what did I ask on Tuesday" still works if the user later changes
   * time zone.
   */
  day: IsoDate;
  /** For assistant turns: the answer record holding this turn's claims. */
  answerId?: string;
};

export type ChatRecord = {
  id: string;
  title: string;
  startedAt: string;
  turns: Turn[];
  /** Demo chats that ship with a fresh install, labelled as such on screen. */
  demo?: boolean;
};

export type StoredClaim = {
  /** What the agent told the user. It may have been wrong. */
  text: string;
  /** The exact words on the source page. */
  quote: string;
  url: string;
  /** The day the source page was read. */
  capturedOn: IsoDate;
  status: ClaimStatus;
};

/** A numbered source cited in an answer, kept so a reopened chat still links its [n] markers. */
export type SourceRecord = {
  n: number;
  url: string;
  title: string;
  readOn: IsoDate;
  /** The date printed on the page, if it had one. */
  pageDay?: IsoDate;
};

export type AnswerRecord = {
  id: string;
  chatId: string;
  at: string;
  day: IsoDate;
  question: string;
  answer: string;
  claims: StoredClaim[];
  sources?: SourceRecord[];
};
