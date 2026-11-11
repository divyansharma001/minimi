import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore, titleFrom } from "./store.ts";
import { fromFile, toFile } from "./files.ts";

const tempDir = () => mkdtemp(join(tmpdir(), "minimi-memory-"));

async function chatWithTwoTurns(store: MemoryStore) {
  const chat = await store.createChat({
    firstMessage: "Compare managed Postgres hosting",
    at: "2026-11-03T10:00:00Z",
    day: "2026-11-03",
  });
  await store.addTurn(chat.id, { role: "user", text: "Compare managed Postgres hosting", at: "2026-11-03T10:00:00Z", day: "2026-11-03" });
  await store.addTurn(chat.id, { role: "assistant", text: "Basalt is $69.", at: "2026-11-03T10:00:05Z", day: "2026-11-03", answerId: "a1" });
  await store.addAnswer({
    id: "a1",
    chatId: chat.id,
    at: "2026-11-03T10:00:05Z",
    day: "2026-11-03",
    question: "Compare managed Postgres hosting",
    answer: "Basalt is $69.",
    claims: [{ text: "Basalt Pro is $69", quote: "Pro: $69 / month", url: "https://basalt.example/pricing", capturedOn: "2026-11-03", status: "supported" }],
  });
  return chat;
}

test("chats and answers survive a restart", async () => {
  const dir = await tempDir();
  const { store } = await MemoryStore.open(dir);
  const chat = await chatWithTwoTurns(store);

  const reopened = (await MemoryStore.open(dir)).store;
  assert.deepEqual(reopened.getChat(chat.id), store.getChat(chat.id));
  assert.equal(reopened.getChat(chat.id)?.turns.length, 2);
  assert.deepEqual(reopened.answersFor(chat.id).map((a) => a.id), ["a1"]);
});

test("files are readable by people and named by date and topic", async () => {
  const dir = await tempDir();
  const { store } = await MemoryStore.open(dir);
  await chatWithTwoTurns(store);

  const [chatFile] = await readdir(join(dir, "chats"));
  assert.match(chatFile ?? "", /^2026-11-03-compare-managed-postgres-hosting-[0-9a-f]{8}\.md$/);
  const text = await readFile(join(dir, "chats", chatFile ?? ""), "utf8");
  assert.match(text, /# Compare managed Postgres hosting/);
  assert.match(text, /\*\*minimi\*\*, 3 Nov 2026/);

  const [answerFile] = await readdir(join(dir, "answers"));
  const answer = await readFile(join(dir, "answers", answerFile ?? ""), "utf8");
  assert.match(answer, /Quote: "Pro: \$69 \/ month"/);
});

test("a message containing --- or headings cannot break its file", async () => {
  const dir = await tempDir();
  const { store } = await MemoryStore.open(dir);
  const tricky = "## Not a heading\n---\nstill my message\n---";
  const chat = await store.createChat({ firstMessage: tricky, at: "2026-11-03T10:00:00Z", day: "2026-11-03" });
  await store.addTurn(chat.id, { role: "user", text: tricky, at: "2026-11-03T10:00:00Z", day: "2026-11-03" });

  const reopened = (await MemoryStore.open(dir)).store;
  assert.equal(reopened.getChat(chat.id)?.turns[0]?.text, tricky);
});

test("one broken file is skipped with a warning, and the rest still load", async () => {
  const dir = await tempDir();
  const { store } = await MemoryStore.open(dir);
  const chat = await chatWithTwoTurns(store);
  await writeFile(join(dir, "chats", "2026-11-04-broken.md"), "not a memory file", "utf8");

  const { store: reopened, warnings } = await MemoryStore.open(dir);
  assert.ok(reopened.getChat(chat.id));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /broken\.md/);
});

test("writes to the same chat at once all land", async () => {
  const dir = await tempDir();
  const { store } = await MemoryStore.open(dir);
  const chat = await store.createChat({ firstMessage: "hi", at: "2026-11-03T10:00:00Z", day: "2026-11-03" });
  // All ten start before any finishes, like two browser tabs saving at once.
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      store.addTurn(chat.id, { role: "user", text: `message ${i}`, at: "2026-11-03T10:00:00Z", day: "2026-11-03" }),
    ),
  );
  const reopened = (await MemoryStore.open(dir)).store;
  assert.equal(reopened.getChat(chat.id)?.turns.length, 10);
  const leftovers = (await readdir(join(dir, "chats"))).filter((n) => n.endsWith(".tmp"));
  assert.deepEqual(leftovers, []);
});

test("an answer id can only be used once, so answers are never overwritten", async () => {
  const dir = await tempDir();
  const { store } = await MemoryStore.open(dir);
  await chatWithTwoTurns(store);
  await assert.rejects(
    store.addAnswer({ id: "a1", chatId: "x", at: "", day: "2026-11-03", question: "", answer: "", claims: [] }),
    /already exists/,
  );
});

test("an empty or missing folder opens as empty memory", async () => {
  const { store, warnings } = await MemoryStore.open(join(await tempDir(), "does-not-exist"));
  assert.deepEqual(store.allChats(), []);
  assert.deepEqual(warnings, []);
});

test("the file format round-trips", () => {
  const record = { id: "x", list: [1, 2], text: "line one\n---\nline two" };
  assert.deepEqual(fromFile(toFile(record, "# body")), record);
});

test("titles are the first line, cut at a word", () => {
  assert.equal(titleFrom("Short question\nmore detail"), "Short question");
  const long = titleFrom("word ".repeat(30));
  assert.ok(long.length <= 81);
  assert.ok(long.endsWith("…"));
  assert.equal(titleFrom("   "), "Untitled chat");
});

// ---------- Deleting ----------

async function threeQuestions(store: MemoryStore) {
  const chat = await store.createChat({ firstMessage: "q1", at: "2026-11-03T10:00:00Z", day: "2026-11-03" });
  for (const n of [1, 2, 3]) {
    const answerId = `a${n}`;
    await store.addTurn(chat.id, { role: "user", text: `q${n}`, at: "2026-11-03T10:00:00Z", day: "2026-11-03" });
    await store.addTurn(chat.id, { role: "assistant", text: `answer ${n}`, at: "2026-11-03T10:00:05Z", day: "2026-11-03", answerId });
    await store.addAnswer({ id: answerId, chatId: chat.id, at: "", day: "2026-11-03", question: `q${n}`, answer: `answer ${n}`, claims: [] });
  }
  return chat;
}

test("deleting a message removes it and its answer, and nothing else", async () => {
  const dir = await tempDir();
  const { store } = await MemoryStore.open(dir);
  const chat = await threeQuestions(store);
  await store.deleteMessage(chat.id, 2);

  const reopened = (await MemoryStore.open(dir)).store;
  assert.deepEqual(reopened.getChat(chat.id)?.turns.map((t) => t.text), ["q1", "answer 1", "q3", "answer 3"]);
  assert.deepEqual(reopened.answersFor(chat.id).map((a) => a.id), ["a1", "a3"]);
  assert.equal((await readdir(join(dir, "answers"))).length, 2);
});

test("cutting from a message, before an edit, removes it and everything after", async () => {
  const dir = await tempDir();
  const { store } = await MemoryStore.open(dir);
  const chat = await threeQuestions(store);
  await store.truncateFrom(chat.id, 2, "q2 edited");
  assert.deepEqual(store.getChat(chat.id)?.turns.map((t) => t.text), ["q1", "answer 1"]);
  assert.deepEqual((await readdir(join(dir, "answers"))).length, 1);
});

test("editing the first message keeps the chat and renames it", async () => {
  const dir = await tempDir();
  const { store } = await MemoryStore.open(dir);
  const chat = await threeQuestions(store);
  const cut = await store.truncateFrom(chat.id, 0, "Which Postgres hosts have a free plan?");
  assert.deepEqual(cut.turns, []);
  assert.equal((await MemoryStore.open(dir)).store.getChat(chat.id)?.title, "Which Postgres hosts have a free plan?");
});

test("only the user's own messages can be deleted or edited", async () => {
  const { store } = await MemoryStore.open(await tempDir());
  const chat = await threeQuestions(store);
  await assert.rejects(store.deleteMessage(chat.id, 1), /not a message from the user/);
  await assert.rejects(store.truncateFrom(chat.id, 99, "x"), /not a message from the user/);
});

test("deleting a chat, or its last message, removes its files", async () => {
  const dir = await tempDir();
  const { store } = await MemoryStore.open(dir);
  const chat = await threeQuestions(store);
  await store.deleteChat(chat.id);
  assert.equal(store.getChat(chat.id), undefined);
  assert.deepEqual(await readdir(join(dir, "chats")), []);
  assert.deepEqual(await readdir(join(dir, "answers")), []);

  const single = await store.createChat({ firstMessage: "only", at: "2026-11-03T10:00:00Z", day: "2026-11-03" });
  await store.addTurn(single.id, { role: "user", text: "only", at: "2026-11-03T10:00:00Z", day: "2026-11-03" });
  assert.equal(await store.deleteMessage(single.id, 0), null, "an emptied chat is gone");
  assert.equal(store.getChat(single.id), undefined);
});
