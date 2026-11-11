// Turns stored records and turn results into what the screen shows.

import type { AnswerRecord, ChatRecord } from "../memory/types.ts";
import type { MemoryStore } from "../memory/store.ts";
import type { TurnResult } from "../agent/turn.ts";
import type { AnswerView, ChatSummary, ChatView, ClaimView, MessageView, SourceView } from "../app/view.ts";

/** "neon.com" from a link, without "www.". */
export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function summary(chat: ChatRecord): ChatSummary {
  return {
    id: chat.id,
    title: chat.title,
    day: chat.turns[0]?.day ?? chat.startedAt.slice(0, 10),
    startedAt: chat.startedAt,
    demo: chat.demo === true,
  };
}

function sourcesOf(record: AnswerRecord): SourceView[] {
  return (record.sources ?? []).map((s) => ({
    n: s.n,
    url: s.url,
    title: s.title,
    site: siteOf(s.url),
    readOn: s.readOn,
    ...(s.pageDay ? { pageDay: s.pageDay } : {}),
  }));
}

/** A saved answer. Claims carry their source number by matching URLs. */
export function answerFromRecord(record: AnswerRecord): AnswerView {
  const sources = sourcesOf(record);
  const claims: ClaimView[] = record.claims.map((c) => ({
    text: c.text,
    status: c.status,
    source: sources.find((s) => s.url === c.url)?.n ?? null,
    site: siteOf(c.url),
    url: c.url,
    readOn: c.capturedOn,
  }));
  return { claims, sources, refused: false, ...(record.process ? { process: record.process } : {}) };
}

export function chatView(store: MemoryStore, chat: ChatRecord): ChatView {
  const messages: MessageView[] = chat.turns.map((turn, i) => {
    const record = turn.answerId ? store.getAnswer(turn.answerId) : undefined;
    return {
      id: `${chat.id}-${i}`,
      turn: i,
      role: turn.role,
      text: turn.text,
      at: turn.at,
      ...(record ? { answer: answerFromRecord(record) } : {}),
    };
  });
  return { ...summary(chat), messages };
}

/** The reply to a turn just run. */
export function messageFromTurn(store: MemoryStore, result: TurnResult): MessageView {
  const chat = store.getChat(result.chatId);
  const last = chat?.turns.at(-1);
  const record = last?.answerId ? store.getAnswer(last.answerId) : undefined;
  const turn = (chat?.turns.length ?? 1) - 1;
  return {
    id: `${result.chatId}-${turn}`,
    turn,
    role: "assistant",
    text: result.answer,
    at: last?.at ?? new Date().toISOString(),
    answer: record ? answerFromRecord(record) : { claims: [], sources: [], refused: result.trace.refused },
  };
}
