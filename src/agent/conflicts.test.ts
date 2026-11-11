import { test } from "node:test";
import assert from "node:assert/strict";
import { checkConflictsShown, findConflicts, withConflicts } from "./conflicts.ts";
import type { FinalClaim } from "./answer.ts";
import type { Evidence } from "../search/tool.ts";

const fact = (text: string, url: string, source: number, more: Partial<FinalClaim> = {}): FinalClaim => ({
  text,
  topic: "Freshsales Growth price per user per month",
  quote: text,
  url,
  status: "supported",
  source,
  oldClaim: null,
  readOn: "2026-11-11",
  conflict: null,
  ...more,
});

const official = fact("Freshsales Growth costs $11 per user per month", "https://www.freshworks.com/crm/pricing", 1);
const review = fact("Freshsales Growth costs $9 per user per month", "https://crmreviews.example/freshsales", 2);

test("two sites with different values on one topic disagree", () => {
  const groups = findConflicts([official, review]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.topic, "Freshsales Growth price per user per month");
  assert.deepEqual(withConflicts([official, review], groups).map((c) => c.conflict), [1, 1]);
});

test("not a disagreement: same value, same site, other topics, or only years differ", () => {
  const agrees = fact("Freshsales Growth is $11 per user per month", "https://crmreviews.example/freshsales", 2);
  assert.deepEqual(findConflicts([official, agrees]), [], "same value from two sites");

  const annual = fact("Freshsales Growth costs $9 per user per month billed annually", "https://www.freshworks.com/crm/faq", 2);
  assert.deepEqual(findConflicts([official, annual]), [], "one site, two values: a monthly and an annual price");

  const other = { ...review, topic: "Freshsales Pro price per user per month" };
  assert.deepEqual(findConflicts([official, other]), [], "different topics");

  const a = fact("Node.js 26 entered LTS in 2026", "https://nodejs.org/en/about/releases", 1, { topic: "Node 26 LTS" });
  const b = fact("Node.js 26 became LTS in 2025", "https://blog.example/node", 2, { topic: "Node 26 LTS" });
  assert.deepEqual(findConflicts([a, b]), [], "years alone do not make a disagreement");
});

test("only new facts with a page behind them count", () => {
  const unconfirmed = { ...review, status: "cannot-confirm" as const };
  assert.deepEqual(findConflicts([official, unconfirmed]), []);
  const oldReport = { ...review, oldClaim: "O1" };
  assert.deepEqual(findConflicts([official, oldReport]), []);
});

test("topics match loosely: case, spacing and punctuation do not matter", () => {
  const loose = { ...review, topic: "  freshsales growth price, per user per month " };
  assert.equal(findConflicts([official, loose]).length, 1);
});

const evidence = (officialFirst: boolean) =>
  [
    { url: official.url, official: officialFirst },
    { url: review.url, official: false },
  ] as unknown as Evidence[];

test("an answer that gives only one side is sent back, naming both", () => {
  const groups = findConflicts([official, review]);
  const problems = checkConflictsShown(groups, "Freshsales Growth is $11 per user per month [1].", evidence(true));
  assert.equal(problems.length, 1);
  assert.equal(problems[0]?.kind, "soft");
  assert.match(problems[0]?.reason ?? "", /disagree.*\[1\].*\$11.*\[2\].*\$9/);
  assert.equal(problems[0]?.research, undefined, "the official page is already in the evidence");
});

test("an answer that gives both sides passes; without the official page, one more search is asked for", () => {
  const groups = findConflicts([official, review]);
  assert.deepEqual(checkConflictsShown(groups, "The official page says $11 [1]; a review says $9 [2].", evidence(true)), []);
  const hidden = checkConflictsShown(groups, "It costs $9 [2].", evidence(false));
  assert.equal(hidden[0]?.research, true);
});
