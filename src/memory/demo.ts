// Demo chats for a fresh copy, so "last Tuesday" or "3 November" questions
// work straight away instead of finding an empty memory.
//
// The chats in demo/ are real: captured with the real agent. On first run
// each one moves to the day its phrase ("last Tuesday") means then, read by
// the same date code the agent uses, so the agent finds it there. The facts
// inside keep the day their page was really read: only the chat is moved.
//
// Seeding happens once. A marker file stops it from coming back, so demo
// chats the user deletes stay deleted, and an existing memory is never touched.

import { access, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { addDays, resolveDates } from "./dates.ts";
import { fromFile } from "./files.ts";
import type { MemoryStore } from "./store.ts";
import type { AnswerRecord, ChatRecord, IsoDate } from "./types.ts";

const MARKER = ".demo-seeded";
const DAY_MS = 86_400_000;

type Manifest = { chats: { id: string; when: string; title?: string }[] };

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function readRecords<T extends { id: string }>(dir: string): Promise<Map<string, T>> {
  const records = new Map<string, T>();
  for (const name of await readdir(dir).catch(() => [])) {
    if (!name.endsWith(".md")) continue;
    const record = fromFile<T>(await readFile(join(dir, name), "utf8"));
    records.set(record.id, record);
  }
  return records;
}

export async function seedDemoChats(input: {
  demoDir: string;
  memoryDir: string;
  store: MemoryStore;
  now: Date;
  timeZone: string;
}): Promise<{ seeded: string[]; warnings: string[] }> {
  const { demoDir, memoryDir, store, now, timeZone } = input;
  const marker = join(memoryDir, MARKER);
  const done = async () => writeFile(marker, `Demo chats were offered on ${now.toISOString()}.\n`, "utf8");
  if (await exists(marker)) return { seeded: [], warnings: [] };
  if (store.allChats().length > 0) {
    await done();
    return { seeded: [], warnings: [] };
  }

  let manifest: Manifest;
  try {
    manifest = JSON.parse(await readFile(join(demoDir, "demo.json"), "utf8")) as Manifest;
  } catch {
    return { seeded: [], warnings: [] }; // No demo folder: nothing to offer.
  }
  const chats = await readRecords<ChatRecord>(join(demoDir, "chats"));
  const answers = await readRecords<AnswerRecord>(join(demoDir, "answers"));

  const seeded: string[] = [];
  const warnings: string[] = [];
  for (const entry of manifest.chats) {
    const chat = chats.get(entry.id);
    const day = resolveDates(entry.when, { now, timeZone }).days[0];
    if (!chat || !day) {
      warnings.push(`Demo chat ${entry.id} was skipped: ${chat ? `"${entry.when}" is not a date` : "its file is missing"}.`);
      continue;
    }
    // Move every time in the chat by the same whole number of days.
    const from = (chat.turns[0]?.day ?? chat.startedAt.slice(0, 10)) as IsoDate;
    const shift = Math.round((Date.parse(day) - Date.parse(from)) / DAY_MS);
    const moved = (at: string) => new Date(Date.parse(at) + shift * DAY_MS).toISOString();

    await store.createChat({ id: chat.id, title: entry.title ?? chat.title, firstMessage: chat.title, at: moved(chat.startedAt), day, demo: true });
    for (const turn of chat.turns) {
      const answer = turn.answerId ? answers.get(turn.answerId) : undefined;
      if (answer) await store.addAnswer({ ...answer, at: moved(answer.at), day: addDays(answer.day, shift) });
      const kept = turn.answerId && !answer ? { ...turn, answerId: undefined } : turn;
      await store.addTurn(chat.id, { ...kept, at: moved(turn.at), day: addDays(turn.day, shift) });
    }
    seeded.push(chat.id);
  }
  await done();
  return { seeded, warnings };
}
