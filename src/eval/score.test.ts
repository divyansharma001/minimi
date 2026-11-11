import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreCase } from "./score.ts";
import type { EvalCase, Trace } from "./types.ts";

function trace(overrides: Partial<Trace> = {}): Trace {
  return {
    resolvedDates: [],
    recalledChatIds: [],
    searchQueries: [],
    pagesRead: [],
    refused: false,
    claims: [],
    answer: "",
    timings: { totalMs: 0, firstTextMs: null },
    ...overrides,
  };
}

function failed(score: ReturnType<typeof scoreCase>): string[] {
  return score.checks.filter((c) => !c.pass).map((c) => c.name);
}

const lastTuesday: EvalCase = {
  id: "t",
  purpose: "",
  question: "",
  expect: {
    resolvedDates: ["2026-11-10", "2026-11-03"],
    recall: ["postgres"],
    notRecall: ["ebikes"],
    search: "required",
    minQueries: 2,
    mention: ["$79"],
    notMention: ["free forever"],
    claims: [{ url: "https://basalt.example/pricing", status: "changed" }],
  },
};

test("a run that does everything right passes every check", () => {
  const score = scoreCase(
    lastTuesday,
    trace({
      resolvedDates: ["2026-11-10", "2026-11-03"],
      recalledChatIds: ["postgres"],
      searchQueries: ["basalt pricing", "harborbase pricing"],
      claims: [{ text: "", quote: "", url: "https://basalt.example/pricing", status: "changed" }],
      answer: "Basalt Pro is now $79 a month.",
    }),
  );
  assert.deepEqual(failed(score), []);
  assert.equal(score.passed, score.total);
});

test("each kind of mistake fails its own check", () => {
  const score = scoreCase(
    lastTuesday,
    trace({
      resolvedDates: ["2026-11-10"],
      recalledChatIds: ["ebikes"],
      searchQueries: ["basalt pricing"],
      claims: [{ text: "", quote: "", url: "https://basalt.example/pricing", status: "same" }],
      answer: "Basalt is free forever.",
    }),
  );
  assert.deepEqual(failed(score), [
    "dates",
    "recall",
    "not recall",
    "fan-out",
    'mentions "$79"',
    'does not mention "free forever"',
    "claim changed: https://basalt.example/pricing",
  ]);
});

test("the same query asked twice counts once for fan-out", () => {
  const testCase: EvalCase = { id: "t", purpose: "", question: "", expect: { search: "required", minQueries: 2 } };
  const score = scoreCase(testCase, trace({ searchQueries: ["CRM pricing", "crm  pricing"] }));
  assert.deepEqual(failed(score), ["fan-out"]);
});

test("an empty recall list means the agent must recall nothing", () => {
  const testCase: EvalCase = { id: "t", purpose: "", question: "", expect: { recall: [], search: "forbidden" } };
  assert.deepEqual(failed(scoreCase(testCase, trace())), []);
  assert.deepEqual(failed(scoreCase(testCase, trace({ recalledChatIds: ["postgres"] }))), ["recall nothing"]);
});

test("re-reading a source counts as checking the web", () => {
  const required: EvalCase = { id: "t", purpose: "", question: "", expect: { search: "required" } };
  assert.deepEqual(failed(scoreCase(required, trace())), ["checked the web"]);
  assert.deepEqual(failed(scoreCase(required, trace({ pagesRead: ["https://fernwood.example/pricing"] }))), []);
});

test("using the web when it is forbidden fails, and optional search is never checked", () => {
  const forbidden: EvalCase = { id: "t", purpose: "", question: "", expect: { search: "forbidden" } };
  const optional: EvalCase = { id: "t", purpose: "", question: "", expect: { search: "optional" } };
  const searched = trace({ searchQueries: ["anything"] });
  assert.deepEqual(failed(scoreCase(forbidden, searched)), ["no web"]);
  assert.deepEqual(failed(scoreCase(forbidden, trace({ pagesRead: ["https://x.example/"] }))), ["no web"]);
  // Only the "not refused" check, which every case has.
  assert.deepEqual(scoreCase(optional, searched).checks.map((c) => c.name), ["not refused"]);
});

test("mention checks ignore case and extra spaces", () => {
  const testCase: EvalCase = { id: "t", purpose: "", question: "", expect: { search: "optional", mention: ["Jane Austen"] } };
  assert.deepEqual(failed(scoreCase(testCase, trace({ answer: "It was JANE   austen." }))), []);
});

test("every case checks refusal, so over-blocking shows up", () => {
  const normal: EvalCase = { id: "t", purpose: "", question: "", expect: { search: "optional" } };
  const harmful: EvalCase = { id: "t", purpose: "", question: "", expect: { search: "forbidden", refused: true } };
  assert.deepEqual(failed(scoreCase(normal, trace({ refused: true }))), ["not refused"]);
  assert.deepEqual(failed(scoreCase(harmful, trace({ refused: false }))), ["refused"]);
  assert.deepEqual(failed(scoreCase(harmful, trace({ refused: true }))), []);
});
