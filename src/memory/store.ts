// The memory folder: one Markdown file per chat and one per answer.
//
//   memory/
//     chats/2026-11-03-compare-managed-postgres-hosting-1a2b3c4d.md
//     answers/2026-11-03-1a2b3c4d-5e6f7a8b.md
//
// The files are the only copy of the truth. At startup every file is read
// into memory, and searches run there. There is no separate index or database
// to fall out of step with the files. This is fast enough for thousands of
// chats; past that, a real index would be worth its upkeep.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fromFile, removeFileSafely, slug, toFile, writeFileSafely } from "./files.ts";
import { redactSecrets } from "../guardrails/redact.ts";
import type { AnswerRecord, ChatRecord, IsoDate, Turn } from "./types.ts";

const CHATS = "chats";
const ANSWERS = "answers";

const shortId = () => randomUUID().slice(0, 8);

/** The first line of the user's first message, cut to a readable length. */
const clean = (text: string) => redactSecrets(text).text;

export function titleFrom(message: string): string {
  const line = clean(message).trim().split("\n")[0] ?? "";
  if (line.length <= 80) return line || "Untitled chat";
  const cut = line.slice(0, 80);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 40 ? lastSpace : 80)}…`;
}

function stamp(at: string): string {
  return new Date(at).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

function chatBody(chat: ChatRecord): string {
  const turns = chat.turns.map(
    (t) => `**${t.role === "user" ? "You" : "minimi"}**, ${stamp(t.at)}\n\n${t.text}`,
  );
  return [
    `<!-- The data is in the block above. This text is written from it, so edit the block instead. -->`,
    `# ${chat.title}`,
    ...turns,
  ].join("\n\n");
}

function answerBody(answer: AnswerRecord): string {
  const claims = answer.claims.map(
    (c, i) =>
      `${i + 1}. ${c.text} (${c.status})\n   Source: ${c.url}, read on ${c.capturedOn}\n   Quote: "${c.quote}"`,
  );
  return [
    `<!-- The data is in the block above. This text is written from it, so edit the block instead. -->`,
    `# Answer to: ${answer.question}`,
    answer.answer,
    "## Claims",
    claims.length > 0 ? claims.join("\n") : "No claims from sources.",
  ].join("\n\n");
}

async function readFolder<T>(folder: string, warnings: string[]): Promise<{ record: T; path: string }[]> {
  let names: string[];
  try {
    names = await readdir(folder);
  } catch {
    return [];
  }
  const records: { record: T; path: string }[] = [];
  for (const name of names.filter((n) => n.endsWith(".md")).sort()) {
    const path = join(folder, name);
    try {
      records.push({ record: fromFile<T>(await readFile(path, "utf8")), path });
    } catch (error) {
      // One broken file must not take the whole memory down.
      warnings.push(`Skipped ${path}: ${(error as Error).message}`);
    }
  }
  return records;
}

export class MemoryStore {
  private readonly chats = new Map<string, ChatRecord>();
  private readonly answers = new Map<string, AnswerRecord>();
  private readonly paths = new Map<string, string>();

  private readonly dir: string;

  private constructor(dir: string) {
    this.dir = dir;
  }

  /** Reads the folder, creating nothing until the first write. */
  static async open(dir: string): Promise<{ store: MemoryStore; warnings: string[] }> {
    const store = new MemoryStore(dir);
    const warnings: string[] = [];
    for (const { record, path } of await readFolder<ChatRecord>(join(dir, CHATS), warnings)) {
      store.chats.set(record.id, record);
      store.paths.set(record.id, path);
    }
    for (const { record, path } of await readFolder<AnswerRecord>(join(dir, ANSWERS), warnings)) {
      store.answers.set(record.id, record);
      store.paths.set(record.id, path);
    }
    return { store, warnings };
  }

  /** All chats, oldest first. */
  allChats(): readonly ChatRecord[] {
    return [...this.chats.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  getChat(id: string): ChatRecord | undefined {
    return this.chats.get(id);
  }

  getAnswer(id: string): AnswerRecord | undefined {
    return this.answers.get(id);
  }

  /** The answers given in a chat, in order. */
  answersFor(chatId: string): readonly AnswerRecord[] {
    return [...this.answers.values()].filter((a) => a.chatId === chatId).sort((a, b) => a.at.localeCompare(b.at));
  }

  async createChat(input: { firstMessage: string; at: string; day: IsoDate; id?: string; title?: string }) {
    const chat: ChatRecord = {
      id: input.id ?? shortId(),
      title: input.title ? clean(input.title) : titleFrom(input.firstMessage),
      startedAt: input.at,
      turns: [],
    };
    const path = join(this.dir, CHATS, `${input.day}-${slug(chat.title)}-${chat.id}.md`);
    this.paths.set(chat.id, path);
    await this.saveChat(chat);
    return chat;
  }

  async addTurn(chatId: string, turn: Turn): Promise<ChatRecord> {
    const chat = this.chats.get(chatId);
    if (!chat) throw new Error(`No chat with id ${chatId}`);
    const updated: ChatRecord = { ...chat, turns: [...chat.turns, { ...turn, text: clean(turn.text) }] };
    await this.saveChat(updated);
    return updated;
  }

  /** Answers are added, never edited: a new answer is a new record. */
  async addAnswer(input: Omit<AnswerRecord, "id"> & { id?: string }): Promise<AnswerRecord> {
    const answer: AnswerRecord = {
      ...input,
      id: input.id ?? shortId(),
      question: clean(input.question),
      answer: clean(input.answer),
    };
    if (this.answers.has(answer.id)) throw new Error(`Answer ${answer.id} already exists`);
    const path = join(this.dir, ANSWERS, `${answer.day}-${answer.chatId}-${answer.id}.md`);
    this.paths.set(answer.id, path);
    this.answers.set(answer.id, answer);
    await writeFileSafely(path, toFile(answer, answerBody(answer)));
    return answer;
  }

  // ---------- Deleting, at the user's request ----------
  // Answers are never edited, but the user may remove what they asked and
  // what was answered. Saved page copies are kept: they are evidence other
  // answers may cite.

  /** Deletes the message at `index` (the user's) and the answer right after it. */
  async deleteMessage(chatId: string, index: number): Promise<ChatRecord | null> {
    const chat = this.requireUserTurn(chatId, index);
    const end = chat.turns[index + 1]?.role === "assistant" ? index + 2 : index + 1;
    return this.removeTurns(chat, index, end);
  }

  /**
   * Deletes the message at `index` and everything after it, before an edit
   * asks `newText` in its place. The chat stays even if this empties it, and
   * editing the first message renames the chat.
   */
  async truncateFrom(chatId: string, index: number, newText: string): Promise<ChatRecord> {
    const chat = this.requireUserTurn(chatId, index);
    const renamed = index === 0 ? { ...chat, title: titleFrom(newText) } : chat;
    return (await this.removeTurns(renamed, index, chat.turns.length, { keepEmpty: true })) as ChatRecord;
  }

  async deleteChat(chatId: string): Promise<void> {
    const chat = this.chats.get(chatId);
    if (!chat) throw new Error(`No chat with id ${chatId}`);
    await this.removeTurns(chat, 0, chat.turns.length);
  }

  private requireUserTurn(chatId: string, index: number): ChatRecord {
    const chat = this.chats.get(chatId);
    if (!chat) throw new Error(`No chat with id ${chatId}`);
    if (chat.turns[index]?.role !== "user") throw new Error(`Turn ${index} is not a message from the user`);
    return chat;
  }

  /** Removes turns [from, to) and their answer files. A chat left empty is deleted. */
  private async removeTurns(chat: ChatRecord, from: number, to: number, options: { keepEmpty?: boolean } = {}): Promise<ChatRecord | null> {
    for (const turn of chat.turns.slice(from, to)) {
      if (!turn.answerId) continue;
      const path = this.paths.get(turn.answerId);
      this.answers.delete(turn.answerId);
      this.paths.delete(turn.answerId);
      if (path) await removeFileSafely(path);
    }
    const turns = [...chat.turns.slice(0, from), ...chat.turns.slice(to)];
    if (turns.length === 0 && !options.keepEmpty) {
      const path = this.paths.get(chat.id);
      this.chats.delete(chat.id);
      this.paths.delete(chat.id);
      if (path) await removeFileSafely(path);
      return null;
    }
    const updated: ChatRecord = { ...chat, turns };
    await this.saveChat(updated);
    return updated;
  }

  private async saveChat(chat: ChatRecord) {
    const path = this.paths.get(chat.id);
    if (!path) throw new Error(`No file path for chat ${chat.id}`);
    this.chats.set(chat.id, chat);
    await writeFileSafely(path, toFile(chat, chatBody(chat)));
  }
}
