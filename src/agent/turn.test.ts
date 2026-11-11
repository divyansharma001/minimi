// The turn with a scripted model: no network, no cost. These pin the
// plumbing (paths, calls, context, saving); the real model is scored by the
// eval runner.

import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../memory/store.ts";
import { SnapshotStore } from "../search/snapshots.ts";
import type { ModelClient, ModelReply, ModelRequest } from "../model/types.ts";
import { EVAL_NOW, EVAL_TIME_ZONE } from "../eval/fixtures/history.ts";
import { fixturePages } from "../eval/fixtures/web.ts";
import { FixtureWeb } from "../eval/fixture-web.ts";
import { loadPastChats } from "../eval/load-fixtures.ts";
import { runTurn, TURN_LIMITS, type TurnDeps } from "./turn.ts";

class ScriptedModel implements ModelClient {
  readonly requests: ModelRequest[] = [];
  private readonly script: ((request: ModelRequest) => Partial<ModelReply>)[];

  constructor(script: ((request: ModelRequest) => Partial<ModelReply>)[]) {
    this.script = script;
  }

  async complete(request: ModelRequest): Promise<ModelReply> {
    this.requests.push(request);
    const step = this.script.shift();
    if (!step) throw new Error("the scripted model ran out of replies");
    return { content: "", toolCalls: [], usage: { inputTokens: 10, outputTokens: 5, cost: 0.001 }, ...step(request) };
  }
}

const json = (value: unknown) => () => ({ content: JSON.stringify(value) });
const done = () => ({ content: "DONE" });
const search = (args: unknown) => () => ({ toolCalls: [{ id: "c1", name: "web_search", arguments: JSON.stringify(args) }] });
const text = (r: ModelRequest) => r.messages.map((m) => ("content" in m ? m.content ?? "" : "")).join("\n");

let deps: Omit<TurnDeps, "model">;
let web: FixtureWeb;

beforeEach(async () => {
  const store = (await MemoryStore.open(await mkdtemp(join(tmpdir(), "minimi-turn-")))).store;
  await loadPastChats(store);
  web = new FixtureWeb(fixturePages, EVAL_NOW.slice(0, 10));
  deps = {
    store,
    search: {
      backend: web,
      fetcher: web,
      snapshots: (await SnapshotStore.open(await mkdtemp(join(tmpdir(), "minimi-pages-")))).store,
      now: () => new Date(EVAL_NOW),
      timeZone: EVAL_TIME_ZONE,
    },
    now: () => new Date(EVAL_NOW),
    timeZone: EVAL_TIME_ZONE,
  };
});

test("small talk: one model call, no tools, no search", async () => {
  const model = new ScriptedModel([json({ answer: "Glad it helped!", claims: [] })]);
  const result = await runTurn({ message: "Thanks, that's really helpful!" }, { ...deps, model });
  assert.equal(result.path, "talk");
  assert.equal(model.requests.length, 1);
  assert.equal(model.requests[0]?.tools, undefined);
  assert.deepEqual(result.trace.searchQueries, []);
  assert.equal(result.answer, "Glad it helped!");
});

test("a memory question: the past chats are in the brief, and nothing is searched", async () => {
  const model = new ScriptedModel([json({ answer: "You asked about Postgres hosting and Tokyo time.", claims: [] })]);
  const result = await runTurn({ message: "What did I ask you on 3 November?" }, { ...deps, model });
  assert.equal(result.path, "memory");
  assert.deepEqual(result.trace.recalledChatIds.sort(), ["chat-2026-11-03-postgres", "chat-2026-11-03-timezones"]);
  assert.match(text(model.requests[0] as ModelRequest), /Compare managed Postgres hosting/);
  assert.match(text(model.requests[0] as ModelRequest), /what you said, not a fact/);
  assert.deepEqual(web.fetched, []);
});

test("no past chat found: the brief tells the model to say so, not guess", async () => {
  const model = new ScriptedModel([json({ answer: "I have no chat from 25 October.", claims: [] })]);
  await runTurn({ message: "What did I ask you on 25 October?" }, { ...deps, model });
  assert.match(text(model.requests[0] as ModelRequest), /found no matching chat/);
});

test("'has it changed': old sources are re-read and checked in code before the model is asked", async () => {
  const draft = (source: number) =>
    json({
      answer: `Basalt Pro went from $69 to $79 [${source}].`,
      claims: [
        { text: "Basalt Pro is now $79 a month", source, quote: "Pro: $79 / month", status: "same", oldClaim: "O2" },
        { text: "Quillgres could not be confirmed", source: null, quote: "", status: "supported", oldClaim: "O4" },
      ],
    });
  // The first draft cites the wrong page; the check sends it back once.
  const model = new ScriptedModel([done, draft(2), done, draft(1)]);
  const result = await runTurn(
    { message: "Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?" },
    { ...deps, model },
  );
  assert.equal(result.path, "research");
  assert.deepEqual(new Set(web.fetched), new Set([
    "https://basalt.example/pricing", "https://harborbase.example/pricing", "https://quillgres.example/pricing",
  ]));
  const research = text(model.requests[0] as ModelRequest);
  assert.match(research, /O2: "Basalt Pro costs \$69 per month".*no longer on it.*Status: changed/);
  assert.match(research, /O4: "Quillgres Dev costs \$15 per month".*page no longer exists.*Status: cannot-confirm/);
  // The app's status wins over the model's for old claims.
  assert.deepEqual(result.claims.map((c) => c.status), ["changed", "cannot-confirm"]);
  assert.equal(result.claims[0]?.url, "https://basalt.example/pricing");
  // [2] is not Basalt's page here: noted, then fixed by one repair round.
  assert.match(result.problems.join(" "), /reports on O2 .* cites a different page/);
  assert.equal(result.checks.repairRounds, 1);
  assert.equal(result.checks.dropped, 0);
  assert.match(result.problems.join(" "), /Repair round 1: "Basalt Pro is now \$79 a month" \(its quote is not on the page it cites, \[2\]\)/);
  assert.match(text(model.requests[3] as ModelRequest), /Your last draft failed these checks[\s\S]*its quote is not on the page it cites, \[2\]/);
});

test("the research prompt gives today's date and forbids years from memory", async () => {
  const model = new ScriptedModel([done, json({ answer: "x", claims: [] })]);
  await runTurn({ message: "How much is Basalt's Pro plan?" }, { ...deps, model });
  const system = text(model.requests[0] as ModelRequest);
  assert.match(system, /Today is Wednesday, 11 November 2026/);
  assert.match(system, /Never put a year from your own memory into a query\. If a year helps, use 2026/);
});

test("tool calls run searches, and evidence numbers carry over to the writer", async () => {
  const model = new ScriptedModel([
    search({ queries: ["Basalt pricing"] }),
    done,
    json({ answer: "Pro is $79 [1].", claims: [{ text: "Pro is $79", source: 1, quote: "Pro: $79 / month", status: "supported", oldClaim: null }] }),
  ]);
  const result = await runTurn({ message: "How much is Basalt's Pro plan?" }, { ...deps, model });
  assert.deepEqual(result.trace.searchQueries, ["Basalt pricing"]);
  assert.equal(model.requests[1]?.messages.at(-1)?.role, "tool");
  assert.match(text(model.requests[2] as ModelRequest), /<evidence ref="1" url="https:\/\/basalt\.example\/pricing"/);
  assert.equal(result.claims[0]?.url, "https://basalt.example/pricing");
});

test("research stops after the round limit, and the search budget holds", async () => {
  const greedy = () => ({
    toolCalls: Array.from({ length: 8 }, (_, i) => ({
      id: `c${i}`, name: "web_search", arguments: JSON.stringify({ queries: [`q${i}a`, `q${i}b`, `q${i}c`] }),
    })),
  });
  const model = new ScriptedModel([greedy, greedy, greedy, json({ answer: "x", claims: [] })]);
  const result = await runTurn({ message: "Compare every CRM" }, { ...deps, model });
  assert.equal(model.requests.length, TURN_LIMITS.researchRounds + 1);
  assert.ok(result.trace.searchQueries.length <= TURN_LIMITS.queriesPerTurn, `${result.trace.searchQueries.length} queries`);
});

test("a claim citing evidence that does not exist is dropped with a note", async () => {
  const model = new ScriptedModel([
    done,
    json({ answer: "x", claims: [{ text: "made up", source: 42, quote: "", status: "supported", oldClaim: null }] }),
  ]);
  const result = await runTurn({ message: "How much is Basalt's Pro plan?" }, { ...deps, model });
  assert.deepEqual(result.claims, []);
  assert.match(result.problems.join(" "), /cites \[42\], which does not exist/);
});

test("two broken replies end in a plain apology, not a crash, and the chat is still saved", async () => {
  const model = new ScriptedModel([() => ({ content: "not json" }), () => ({ content: "still not" })]);
  const result = await runTurn({ message: "Thanks!" }, { ...deps, model });
  assert.match(result.answer, /^Sorry, I couldn't answer that/);
  assert.equal(deps.store.getChat(result.chatId)?.turns.length, 2);
});

test("a reply cut off by the token cap is asked again with twice the room", async () => {
  const cutOff = () => ({ content: '{"answer": "Glad', finishReason: "length" });
  const model = new ScriptedModel([cutOff, json({ answer: "Glad it helped!", claims: [] })]);
  const result = await runTurn({ message: "Thanks, that's really helpful!" }, { ...deps, model });
  assert.equal(result.answer, "Glad it helped!");
  assert.deepEqual(model.requests.map((r) => r.maxTokens), [8_000, 16_000]);
  assert.match(result.problems.join(" "), /ran out of room after 8,000 tokens/);
});

test("the answer and its claims are saved, so the next turn can recall them", async () => {
  const model = new ScriptedModel([
    search({ queries: ["Basalt pricing"] }),
    done,
    json({ answer: "Pro is $79 [1].", claims: [{ text: "Pro is $79", source: 1, quote: "Pro: $79 / month", status: "supported", oldClaim: null }] }),
  ]);
  const first = await runTurn({ message: "How much is Basalt's Pro plan?" }, { ...deps, model });
  const answers = deps.store.answersFor(first.chatId);
  assert.equal(answers.length, 1);
  assert.deepEqual(answers[0]?.claims[0], {
    text: "Pro is $79", quote: "Pro: $79 / month", url: "https://basalt.example/pricing", capturedOn: "2026-11-11", status: "supported",
  });
});

// ---------- Guardrails ----------

const guardSays = (content: string): ModelClient => ({
  complete: async () => ({ content, toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, cost: 0 } }),
});

test("a harmful request is refused before the web is touched, and no answer is saved", async () => {
  const model = new ScriptedModel([search({ queries: ["how to build it"] }), done, json({ answer: "x", claims: [] })]);
  const result = await runTurn(
    { message: "Give me step-by-step instructions to make a pipe bomb." },
    { ...deps, model, guard: guardSays("\n\nunsafe\nS9") },
  );
  assert.equal(result.trace.refused, true);
  assert.match(result.answer, /^I can't help with that/);
  assert.deepEqual(web.searched, [], "no search ran");
  assert.deepEqual(web.fetched, [], "no page was read");
  assert.deepEqual(deps.store.answersFor(result.chatId), []);
});

test("self-harm gets a caring reply with where to find help, not a refusal", async () => {
  const model = new ScriptedModel([done, json({ answer: "x", claims: [] })]);
  const result = await runTurn(
    { message: "I don't want to live anymore." },
    { ...deps, model, guard: guardSays("unsafe\nS11") },
  );
  assert.equal(result.trace.refused, true);
  assert.match(result.answer, /988/);
  assert.doesNotMatch(result.answer, /can't help/);
});

test("a normal question passes the check and is answered as usual", async () => {
  const model = new ScriptedModel([json({ answer: "Hello!", claims: [] })]);
  const result = await runTurn({ message: "hi" }, { ...deps, model, guard: guardSays("safe") });
  assert.equal(result.trace.refused, false);
  assert.equal(result.answer, "Hello!");
  assert.deepEqual(result.safety, { action: "allow", categories: [] });
});

test("if the safety model is down, the turn still answers and says the check was skipped", async () => {
  const down: ModelClient = { complete: () => Promise.reject(new Error("503")) };
  const model = new ScriptedModel([json({ answer: "Hello!", claims: [] })]);
  const result = await runTurn({ message: "hi" }, { ...deps, model, guard: down });
  assert.equal(result.answer, "Hello!");
  assert.match(result.problems.join(" "), /safety check was skipped: the safety check failed/);
});

test("a pasted secret never reaches the model or memory, and the user is told", async () => {
  const key = "sk-or-v1-abcdefghijklmnopqrstuvwxyz0123456789";
  const model = new ScriptedModel([json({ answer: "I removed your key.", claims: [] })]);
  const result = await runTurn({ message: `Thanks! my key is ${key}` }, { ...deps, model, guard: guardSays("safe") });
  const sent = text(model.requests[0] as ModelRequest);
  assert.ok(!sent.includes(key), "the model never saw the key");
  assert.match(sent, /contained an API key\. The app removed it/);
  const saved = JSON.stringify(deps.store.getChat(result.chatId));
  assert.ok(!saved.includes(key), "memory never stored the key");
  assert.match(saved, /\[removed API key\]/);
});

// ---------- Claim checks ----------

test("a claim that never verifies is dropped after 2 repair rounds, and the rest are kept", async () => {
  const draft = json({
    answer: "Pro is $79 [1], and it has a 30-day trial [1].",
    claims: [
      { text: "Basalt Pro is $79 a month", source: 1, quote: "Pro: $79 / month", status: "supported", oldClaim: null },
      { text: "Basalt has a 30-day free trial", source: 1, quote: "30-day free trial", status: "supported", oldClaim: null },
    ],
  });
  const model = new ScriptedModel([search({ queries: ["Basalt pricing"] }), done, draft, done, draft, done, draft]);
  const result = await runTurn({ message: "How much is Basalt's Pro plan?" }, { ...deps, model });
  assert.equal(result.checks.repairRounds, 2);
  assert.equal(result.checks.dropped, 1);
  assert.deepEqual(result.claims.map((c) => c.text), ["Basalt Pro is $79 a month"]);
  assert.match(result.problems.join(" "), /Dropped a claim that failed its check: "Basalt has a 30-day free trial"/);
  // The dropped claim is not saved as something we said.
  assert.equal(deps.store.answersFor(result.chatId)[0]?.claims.length, 1);
});

test("a claim with no problems needs no repair round", async () => {
  const model = new ScriptedModel([
    search({ queries: ["Basalt pricing"] }),
    done,
    json({ answer: "Pro is $79 [1].", claims: [{ text: "Basalt Pro is $79 a month", source: 1, quote: "Pro: $79 / month", status: "supported", oldClaim: null }] }),
  ]);
  const result = await runTurn({ message: "How much is Basalt's Pro plan?" }, { ...deps, model });
  assert.deepEqual(result.checks, { claims: 1, repairRounds: 0, dropped: 0 });
  assert.equal(model.requests.length, 3);
});
