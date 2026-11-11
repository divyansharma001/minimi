import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedDemoChats } from "./demo.ts";
import { MemoryStore } from "./store.ts";

const tempDir = () => mkdtemp(join(tmpdir(), "minimi-demo-"));

// A demo folder like demo/: one chat captured on Wednesday 11 Nov 2026.
async function demoFolder() {
  const dir = await tempDir();
  const { store } = await MemoryStore.open(dir);
  const chat = await store.createChat({ id: "pg", firstMessage: "Compare Postgres hosts", at: "2026-11-11T08:54:34.000Z", day: "2026-11-11" });
  await store.addTurn(chat.id, { role: "user", text: "Compare Postgres hosts", at: "2026-11-11T08:54:34.000Z", day: "2026-11-11" });
  await store.addAnswer({
    id: "a1", chatId: "pg", at: "2026-11-11T08:55:30.000Z", day: "2026-11-11", question: "Compare Postgres hosts", answer: "Neon is usage-based.",
    claims: [{ text: "Neon Launch is $0.106 per CU-hour", quote: "$0.106 per CU-hour", url: "https://neon.com/pricing", capturedOn: "2026-11-11", status: "supported" }],
  });
  await store.addTurn(chat.id, { role: "assistant", text: "Neon is usage-based.", at: "2026-11-11T08:55:30.000Z", day: "2026-11-11", answerId: "a1" });
  await writeFile(join(dir, "demo.json"), JSON.stringify({ chats: [{ id: "pg", when: "last Tuesday", title: "Postgres hosting" }] }));
  return dir;
}

// Monday 30 Nov 2026, so "last Tuesday" is 24 Nov.
const now = new Date("2026-11-30T10:00:00Z");

test("demo chats move to the day their phrase means; facts keep their real read day", async () => {
  const memoryDir = await tempDir();
  const { store } = await MemoryStore.open(memoryDir);
  const result = await seedDemoChats({ demoDir: await demoFolder(), memoryDir, store, now, timeZone: "UTC" });
  assert.deepEqual(result, { seeded: ["pg"], warnings: [] });

  const reopened = (await MemoryStore.open(memoryDir)).store;
  const chat = reopened.getChat("pg");
  assert.equal(chat?.demo, true);
  assert.equal(chat?.title, "Postgres hosting");
  assert.equal(chat?.startedAt, "2026-11-24T08:54:34.000Z");
  assert.deepEqual(chat?.turns.map((t) => [t.day, t.at]), [
    ["2026-11-24", "2026-11-24T08:54:34.000Z"],
    ["2026-11-24", "2026-11-24T08:55:30.000Z"],
  ]);
  const answer = reopened.getAnswer("a1");
  assert.equal(answer?.day, "2026-11-24");
  assert.equal(answer?.claims[0]?.capturedOn, "2026-11-11", "a fact keeps the day its page was read");
});

test("demo chats are offered once: deleted ones do not come back", async () => {
  const demoDir = await demoFolder();
  const memoryDir = await tempDir();
  const { store } = await MemoryStore.open(memoryDir);
  await seedDemoChats({ demoDir, memoryDir, store, now, timeZone: "UTC" });
  await store.deleteChat("pg");
  const again = await seedDemoChats({ demoDir, memoryDir, store, now, timeZone: "UTC" });
  assert.deepEqual(again.seeded, []);
  assert.deepEqual(await readdir(join(memoryDir, "chats")), []);
});

test("an existing memory is never given demo chats", async () => {
  const memoryDir = await tempDir();
  const { store } = await MemoryStore.open(memoryDir);
  await store.createChat({ firstMessage: "my own chat", at: "2026-11-20T10:00:00Z", day: "2026-11-20" });
  const result = await seedDemoChats({ demoDir: await demoFolder(), memoryDir, store, now, timeZone: "UTC" });
  assert.deepEqual(result.seeded, []);
  assert.equal(store.allChats().length, 1);
});

test("the shipped demo folder loads cleanly", async () => {
  const memoryDir = await tempDir();
  const { store } = await MemoryStore.open(memoryDir);
  const demoDir = join(import.meta.dirname, "..", "..", "demo");
  const result = await seedDemoChats({ demoDir, memoryDir, store, now, timeZone: "UTC" });
  assert.equal(result.warnings.length, 0, result.warnings.join(" "));
  assert.equal(result.seeded.length, 3);
  for (const chat of store.allChats()) {
    assert.equal(chat.demo, true);
    for (const turn of chat.turns) if (turn.answerId) assert.ok(store.getAnswer(turn.answerId), `answer ${turn.answerId} loaded`);
  }
});
