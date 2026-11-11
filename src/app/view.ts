// What the server sends to the chat screen. Plain data, safe to send to a
// browser: no quotes from pages beyond what the answer shows, no keys, no paths.

import type { AnswerProcess, ClaimStatus } from "@/memory/types.ts";

export type ChatSummary = {
  id: string;
  title: string;
  /** The day the chat started, YYYY-MM-DD in the user's time zone. */
  day: string;
  startedAt: string;
  demo: boolean;
};

export type ClaimView = {
  text: string;
  status: ClaimStatus;
  /** The [n] of its source, or null when nothing could be cited. */
  source: number | null;
  site: string;
  url: string;
  readOn: string;
  /** What the fact is about. */
  topic?: string;
  /** Facts with the same number come from sources that disagree; null if none. */
  conflict: number | null;
};

export type SourceView = {
  n: number;
  url: string;
  title: string;
  site: string;
  readOn: string;
  pageDay?: string;
};

export type AnswerView = {
  claims: ClaimView[];
  sources: SourceView[];
  /** True when the safety check stopped the answer. */
  refused: boolean;
  /** The steps taken, for the thought process. Missing on older answers. */
  process?: AnswerProcess;
};

export type MessageView = {
  id: string;
  /** Its place in the chat, used to edit or delete it. Missing until saved. */
  turn?: number;
  role: "user" | "assistant";
  text: string;
  at: string;
  answer?: AnswerView;
};

export type ChatView = ChatSummary & { messages: MessageView[] };

/** One line of the streamed reply from POST /api/chat. */
export type ChatEvent =
  | { type: "chat"; chat: ChatSummary }
  | { type: "status"; text: string }
  | { type: "message"; message: MessageView }
  | { type: "error"; message: string };
