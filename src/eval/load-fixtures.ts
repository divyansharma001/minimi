// Writes the test set's past chats into a memory folder, using the same store
// the app uses. So the tests read memory exactly as the agent will.

import type { MemoryStore } from "../memory/store.ts";
import { pastChats } from "./fixtures/history.ts";

export async function loadPastChats(store: MemoryStore): Promise<void> {
  for (const past of pastChats) {
    const at = `${past.date}T10:00:00Z`;
    const answeredAt = `${past.date}T10:00:05Z`;
    const answerId = `${past.id}-answer`;

    await store.createChat({ id: past.id, title: past.topic, firstMessage: past.userMessage, at, day: past.date });
    await store.addTurn(past.id, { role: "user", text: past.userMessage, at, day: past.date });
    await store.addTurn(past.id, { role: "assistant", text: past.answer, at: answeredAt, day: past.date, answerId });
    await store.addAnswer({
      id: answerId,
      chatId: past.id,
      at: answeredAt,
      day: past.date,
      question: past.userMessage,
      answer: past.answer,
      claims: past.claims.map((c) => ({ ...c, status: "supported" })),
    });
  }
}
