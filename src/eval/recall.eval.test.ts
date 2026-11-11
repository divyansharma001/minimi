// Runs the memory half of the test set now, with no model involved.
//
// Every case's date and recall expectations are checked against the real
// date resolver and the real memory store. The model can only make an answer
// worse than its evidence, so if recall is wrong here, no prompt can fix it.

import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../memory/store.ts";
import { recall } from "../memory/recall.ts";
import { evalCases } from "./cases.ts";
import { EVAL_NOW, EVAL_TIME_ZONE } from "./fixtures/history.ts";
import { loadPastChats } from "./load-fixtures.ts";

let store: MemoryStore;

before(async () => {
  store = (await MemoryStore.open(await mkdtemp(join(tmpdir(), "minimi-eval-")))).store;
  await loadPastChats(store);
});

describe("recall on the test set", () => {
  for (const c of evalCases) {
    const { resolvedDates, recall: wanted, notRecall } = c.expect;
    if (!resolvedDates && !wanted && !notRecall) continue;

    test(c.id, () => {
      const result = recall(store, c.question, { now: new Date(EVAL_NOW), timeZone: EVAL_TIME_ZONE });
      const ids = result.chats.map((r) => r.chat.id);

      for (const day of resolvedDates ?? []) {
        assert.ok(result.dates.days.includes(day), `date ${day} missing; got ${result.dates.days.join(", ")}`);
      }
      if (wanted && wanted.length === 0) assert.deepEqual(ids, [], "expected to recall nothing");
      for (const id of wanted ?? []) assert.ok(ids.includes(id), `did not recall ${id}; got ${ids.join(", ") || "nothing"}`);
      for (const id of notRecall ?? []) assert.ok(!ids.includes(id), `wrongly recalled ${id}`);
    });
  }
});

test("a weak match says which topic words were not found", () => {
  const result = recall(store, "Remember when I asked you about Redis hosting?", {
    now: new Date(EVAL_NOW),
    timeZone: EVAL_TIME_ZONE,
  });
  const first = result.chats[0];
  assert.equal(first?.chat.id, "chat-2026-11-03-postgres");
  assert.deepEqual(first?.matchedTerms, ["hosting"]);
  assert.deepEqual(first?.missingTerms, ["redis"]);
  assert.equal(first?.weak, true);
});

test("a chat found by its date is never a weak match, whatever topic words are missing", () => {
  const result = recall(store, "On Monday we shortlisted 5 CRM tools. Has any of them shipped something big since?", {
    now: new Date(EVAL_NOW),
    timeZone: EVAL_TIME_ZONE,
  });
  assert.equal(result.chats[0]?.chat.id, "chat-2026-11-09-crm");
  assert.ok((result.chats[0]?.missingTerms.length ?? 0) > 0);
  assert.equal(result.chats[0]?.weak, false);
});

test("the chat the user is in now is never recalled into itself", () => {
  const result = recall(store, "What did I ask you on 3 November?", {
    now: new Date(EVAL_NOW),
    timeZone: EVAL_TIME_ZONE,
    excludeChatId: "chat-2026-11-03-postgres",
  });
  assert.deepEqual(
    result.chats.map((r) => r.chat.id),
    ["chat-2026-11-03-timezones"],
  );
});

test("recalled chats come with their answers and claims", () => {
  const result = recall(store, "Last Tuesday I asked you about Postgres hosting", {
    now: new Date(EVAL_NOW),
    timeZone: EVAL_TIME_ZONE,
  });
  const claims = result.chats[0]?.answers.flatMap((a) => a.claims) ?? [];
  assert.equal(claims.length, 4);
  assert.ok(claims.every((c) => c.quote.length > 0 && c.capturedOn === "2026-11-03"));
});
