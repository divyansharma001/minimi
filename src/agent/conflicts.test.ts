import { test } from "node:test";
import assert from "node:assert/strict";
import { checkConflictsShown, findConflicts, valuesIn, withConflicts } from "./conflicts.ts";
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

test("dates are read as dates, whatever the format", () => {
  assert.deepEqual(valuesIn("supported until April 30, 2028"), ["d:2028-4-30"]);
  assert.deepEqual(valuesIn("End-of-Life date of 2028-04-30"), ["d:2028-4-30"]);
  assert.deepEqual(valuesIn("ends on 30 April 2028"), ["d:2028-4-30"]);
  assert.deepEqual(valuesIn("since Oct 2025"), ["d:2025-10-"]);
  assert.deepEqual(valuesIn("from May 1st"), ["d:-5-1"]);
  assert.deepEqual(valuesIn("Pro is $39, or $47 monthly, in 2026"), ["39", "47"], "bare years are not values");
  assert.deepEqual(valuesIn("Node.js 24 is supported", ["24"]), [], "numbers from the topic are not values");
});

// Real false alarms from a live run (Node.js demo, 11 Nov 2026).
const nodeFact = (text: string, site: string, topic: string) =>
  fact(text, `https://${site}/node`, 1, { topic });

test("not a disagreement: the same date written two ways", () => {
  const topic = "Node.js 24 LTS status";
  const a = nodeFact("Node.js 24 is in Maintenance LTS and supported until April 30, 2028.", "stackchief.com", topic);
  const b = nodeFact("Node.js 24 has an End-of-Life date of 2028-04-30.", "hidekazu-konishi.com", topic);
  assert.deepEqual(findConflicts([a, b]), []);
});

test("not a disagreement: one fact says more, and agrees on what both say", () => {
  const topic = "Node.js 22 LTS status";
  const a = nodeFact("Node.js 22 has been in maintenance since October 2025 and reaches end of life on 30 April 2027.", "linkedin.com", topic);
  const b = nodeFact("Node.js 22 has an End-of-Life date of 2027-04-30.", "hidekazu-konishi.com", topic);
  assert.deepEqual(findConflicts([a, b]), []);
});

test("not a disagreement: only one side gives a value", () => {
  const topic = "Node.js 20 security patches after EOL";
  const a = nodeFact("After the EOL date, the Node.js project no longer ships security patches or fixes for the 20 line.", "herodevs.com", topic);
  const b = nodeFact("From May 1, 2026, any vulnerability discovered in Node.js 20 won't receive an official patch.", "tuxcare.com", topic);
  assert.deepEqual(findConflicts([a, b]), []);
});

test("a real disagreement from the same run is still found", () => {
  const topic = "Zoho CRM Enterprise price per user per month";
  const a = fact("One source lists Zoho Enterprise Edition at $52 per user per month.", "https://vendorbenchmark.com/zoho", 1, { topic });
  const b = fact("Another source puts Zoho Enterprise at $40 per user per month annual and $50 monthly.", "https://www.method.me/zoho", 2, { topic });
  assert.equal(findConflicts([a, b]).length, 1);
});

test("different dates for the same event are a disagreement", () => {
  const topic = "Node.js 22 end of life";
  const a = nodeFact("Node.js 22 reaches end of life on 30 April 2027.", "nodejs.org", topic);
  const b = nodeFact("Node.js 22 reaches end of life on 2027-10-31.", "oldblog.example", topic);
  assert.equal(findConflicts([a, b]).length, 1);
});
