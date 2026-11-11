// Finds the past chats a message is talking about.
//
// The order is: exact first, meaning last.
// 1. Only look back if the user points at the past ("I asked", "you told me",
//    "remember"). A new question gets a fresh answer, not old chats mixed in.
// 2. Dates first, worked out in code. "Last Tuesday" keeps both likely days.
// 3. Then topic words, by keyword score. If a day had several chats, the topic
//    picks the right one. If nothing on that day matches the topic, every chat
//    from that day is returned, so the agent can say what was there instead.
// 4. Each result says which topic words matched and which did not, so the
//    agent can be honest about a weak match ("Redis" not found, only "hosting").

import { resolveDates, withoutDatePhrases, type DateResolution } from "./dates.ts";
import { KeywordIndex, terms } from "../text/keywords.ts";
import type { AnswerRecord, ChatRecord } from "./types.ts";
import type { MemoryStore } from "./store.ts";

export type RecalledChat = {
  chat: ChatRecord;
  answers: readonly AnswerRecord[];
  matchedTerms: string[];
  missingTerms: string[];
  /**
   * True when nothing but a few topic words points to this chat: no date in
   * the message matched it, and it shares at most half the topic words.
   * A chat found by its date is the right chat; topic words only pick
   * between chats on that day.
   */
  weak: boolean;
};

export type RecallResult = {
  dates: DateResolution;
  refersToPast: boolean;
  /** The topic words taken from the message. */
  topicTerms: string[];
  chats: RecalledChat[];
};

// "I asked", "you told me", "we shortlisted", "remember", "last time" ...
const PAST_REFERENCE = new RegExp(
  [
    String.raw`\b(remember|recall|last time|previously|earlier|before)\b`,
    String.raw`\b(i|we|you)\s+(asked|ask|told|tell|said|say|mentioned|talked|talk|discussed|spoke|shortlisted|chose|picked|compared|looked|answered|recommended|suggested|gave)\b`,
    String.raw`\byour (answer|advice|reply|recommendation|suggestion)\b`,
  ].join("|"),
  "i",
);

export function refersToPast(message: string): boolean {
  return PAST_REFERENCE.test(message);
}

function chatText(chat: ChatRecord): string {
  return [chat.title, ...chat.turns.map((t) => t.text)].join("\n");
}

export function recall(
  store: MemoryStore,
  message: string,
  options: { now: Date; timeZone: string; excludeChatId?: string; limit?: number },
): RecallResult {
  const limit = options.limit ?? 5;
  const dates = resolveDates(message, options);
  const pointsBack = refersToPast(message);
  const topic = terms(withoutDatePhrases(message, dates));
  const topicTerms = [...new Set(topic.map((t) => t.word))];
  const empty: RecallResult = { dates, refersToPast: pointsBack, topicTerms, chats: [] };
  if (!pointsBack) return empty;

  // The chat the user is in right now is already in the prompt.
  const chats = store.allChats().filter((c) => c.id !== options.excludeChatId);
  const byId = new Map(chats.map((c) => [c.id, c]));

  // For each chat, the best (lowest) position of any of its days in the
  // resolved date list. Lower means a more likely reading of the user's words.
  const dateRank = new Map<string, number>();
  if (dates.days.length > 0) {
    for (const chat of chats) {
      const ranks = chat.turns.map((t) => dates.days.indexOf(t.day)).filter((r) => r >= 0);
      if (ranks.length > 0) dateRank.set(chat.id, Math.min(...ranks));
    }
  }

  const candidates = dates.days.length > 0 ? [...dateRank.keys()] : chats.map((c) => c.id);
  const index = new KeywordIndex(chats.map((c) => ({ id: c.id, text: chatText(c) })));
  const hits = topic.length > 0 ? index.search(topic, { only: new Set(candidates) }) : [];

  let chosen: { id: string; matched: string[] }[];
  if (hits.length > 0) {
    chosen = hits
      .sort((a, b) => (dateRank.get(a.id) ?? 0) - (dateRank.get(b.id) ?? 0) || b.score - a.score)
      .map((h) => ({ id: h.id, matched: h.matched }));
  } else if (dates.days.length > 0) {
    // Nothing on those days matched the topic (or there was no topic):
    // return everything from those days.
    chosen = candidates
      .sort((a, b) => (dateRank.get(a) ?? 0) - (dateRank.get(b) ?? 0))
      .map((id) => ({ id, matched: [] }));
  } else if (topic.length === 0) {
    // "Remember what I asked you?" with no date and no topic: the latest chats.
    chosen = chats.slice(-3).reverse().map((c) => ({ id: c.id, matched: [] }));
  } else {
    chosen = [];
  }

  return {
    ...empty,
    chats: chosen.slice(0, limit).flatMap(({ id, matched }) => {
      const chat = byId.get(id);
      if (!chat) return [];
      const byDate = dateRank.has(id);
      return [
        {
          chat,
          answers: store.answersFor(id),
          matchedTerms: matched,
          missingTerms: topicTerms.filter((t) => !matched.includes(t)),
          weak: !byDate && topicTerms.length > 0 && matched.length * 2 <= topicTerms.length,
        },
      ];
    }),
  };
}
