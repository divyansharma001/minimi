import { test } from "node:test";
import assert from "node:assert/strict";
import { applyRepair, draftSection } from "./repair.ts";
import type { ParsedAnswer } from "./answer.ts";
import type { Evidence } from "../search/tool.ts";

const evidence = [
  { url: "https://basalt.example/pricing", title: "Basalt pricing", heading: "", text: "Pro: $79 / month", readOn: "2026-11-11", snippetOnly: false },
  { url: "https://basalt.example/faq", title: "Basalt FAQ", heading: "", text: "30-day free trial", readOn: "2026-11-11", snippetOnly: false },
] as Evidence[];

const draft: ParsedAnswer = {
  answer: "Basalt Pro costs $69 a month [1]. There is a 30-day free trial [2].",
  claims: [
    { text: "Basalt Pro costs $69 a month", topic: "Basalt Pro price", quote: "Pro: $79 / month", url: "https://basalt.example/pricing", status: "supported", source: 1, oldClaim: null, readOn: "2026-11-11", conflict: null },
    { text: "Basalt has a 30-day free trial", topic: "Basalt trial", quote: "30-day free trial", url: "https://basalt.example/faq", status: "supported", source: 2, oldClaim: null, readOn: "2026-11-11", conflict: null },
  ],
  problems: [],
};

const fix = (number: number, more: Record<string, unknown> = {}) => ({
  number, remove: false, text: "Basalt Pro costs $79 a month", topic: "Basalt Pro price", source: 1, quote: "Pro: $79 / month", status: "supported", oldClaim: null, ...more,
});
const apply = (reply: unknown) => applyRepair(draft, JSON.stringify(reply), evidence, [], "2026-11-11");

test("a wrong number is fixed in the text and in its claim; the rest is untouched", () => {
  const result = apply({ edits: [{ find: "costs $69 a month", replace: "costs $79 a month" }], claims: [fix(1)] });
  assert.equal(result?.answer, "Basalt Pro costs $79 a month [1]. There is a 30-day free trial [2].");
  assert.equal(result?.claims[0]?.text, "Basalt Pro costs $79 a month");
  assert.deepEqual(result?.claims[1], draft.claims[1]);
});

test("a claim can be removed or added", () => {
  const removed = apply({ edits: [{ find: " There is a 30-day free trial [2].", replace: "" }], claims: [{ ...fix(2), remove: true }] });
  assert.equal(removed?.claims.length, 1);
  assert.equal(removed?.answer, "Basalt Pro costs $69 a month [1].");
  const added = apply({ edits: [], claims: [fix(0, { text: "Basalt Pro is $79 a month", topic: "Basalt Pro price" })] });
  assert.equal(added?.claims.length, 3);
});

test("anything unsafe falls back to a full re-write", () => {
  assert.equal(apply({ edits: [{ find: "not in the draft", replace: "x" }], claims: [] }), null, "edit text not found");
  assert.equal(apply({ edits: [{ find: "a", replace: "x" }], claims: [] }), null, "edit text found more than once");
  assert.equal(apply({ edits: [], claims: [fix(9)] }), null, "no such claim");
  assert.equal(applyRepair(draft, "not json", evidence, [], "2026-11-11"), null);
  assert.equal(apply({ edits: [{ find: draft.answer, replace: " " }], claims: [] }), null, "an empty answer");
});

test("a fixed claim goes through the same reader as the writer's: bad evidence numbers are dropped", () => {
  const result = apply({ edits: [], claims: [fix(1, { source: 42 })] });
  assert.equal(result?.claims[0]?.text, "Basalt Pro costs $69 a month", "the draft claim stays, to be checked again");
  assert.match(result?.problems.join(" ") ?? "", /\[42\], which does not exist/);
});

test("the draft is shown with numbered claims", () => {
  const text = draftSection(draft);
  assert.match(text, /## Your draft answer\nBasalt Pro costs \$69/);
  assert.match(text, /"number":1,"text":"Basalt Pro costs \$69 a month"/);
  assert.match(text, /"number":2,/);
});
