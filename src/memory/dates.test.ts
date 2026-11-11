import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDates, todayIn } from "./dates.ts";

// Wednesday 11 November 2026, the same clock as the test set.
const now = new Date("2026-11-11T10:00:00Z");
const days = (message: string) => resolveDates(message, { now, timeZone: "UTC" }).days;
const notes = (message: string) =>
  resolveDates(message, { now, timeZone: "UTC" }).phrases.flatMap((p) => (p.note ? [p.note] : []));

test("'last Tuesday' keeps both readings, nearest first", () => {
  assert.deepEqual(days("Last Tuesday I asked about Postgres"), ["2026-11-10", "2026-11-03"]);
});

test("'on Monday' and a bare weekday work the same way", () => {
  assert.deepEqual(days("On Monday we shortlisted 5 CRM tools"), ["2026-11-09", "2026-11-02"]);
  assert.deepEqual(days("what did I ask on friday?"), ["2026-11-06", "2026-10-30"]);
});

test("the weekday of today means a week ago, not today", () => {
  assert.deepEqual(days("on Wednesday"), ["2026-11-04", "2026-10-28"]);
});

test("relative days", () => {
  assert.deepEqual(days("What did I ask you yesterday?"), ["2026-11-10"]);
  assert.deepEqual(days("the day before yesterday"), ["2026-11-09"]);
  assert.deepEqual(days("earlier today"), ["2026-11-11"]);
  assert.deepEqual(days("3 days ago"), ["2026-11-08"]);
  assert.deepEqual(days("two days ago"), ["2026-11-09"]);
});

test("'a week ago' is loose: the exact day, then a day either side", () => {
  assert.deepEqual(days("a week ago"), ["2026-11-04", "2026-11-03", "2026-11-05"]);
});

test("every common way of writing 3 November", () => {
  for (const text of ["3 November", "3rd of November", "November 3", "Nov 3rd, 2026", "3 Nov.", "2026-11-03"]) {
    assert.deepEqual(days(`on ${text}`), ["2026-11-03"], text);
  }
});

test("a day still to come this year means last year, with a note", () => {
  assert.deepEqual(days("What did I ask you on 20 November?"), ["2025-11-20"]);
  assert.match(notes("on 20 November")[0] ?? "", /has not happened yet/);
});

test("a future date with a year stays as written, with a note", () => {
  assert.deepEqual(days("on 20 November 2026"), ["2026-11-20"]);
  assert.match(notes("on 20 November 2026")[0] ?? "", /is in the future/);
});

test("'last week' is Monday to Sunday of the week before, with a note", () => {
  const result = days("What did we talk about last week?");
  assert.equal(result.length, 7);
  assert.equal(result[0], "2026-11-02");
  assert.equal(result.at(-1), "2026-11-08");
  assert.match(notes("last week")[0] ?? "", /Monday, 2 November 2026 to Sunday, 8 November 2026/);
});

test("'this week' runs from Monday to today, and 'past week' is the 7 days before today", () => {
  assert.deepEqual(days("this week"), ["2026-11-09", "2026-11-10", "2026-11-11"]);
  const past = days("in the past week");
  assert.equal(past[0], "2026-11-04");
  assert.equal(past.at(-1), "2026-11-10");
});

test("'last month' is the whole previous month", () => {
  const result = days("last month");
  assert.equal(result.length, 31);
  assert.equal(result[0], "2026-10-01");
  assert.equal(result.at(-1), "2026-10-31");
});

test("several phrases in one message are kept in the order written", () => {
  assert.deepEqual(days("on 3 November and yesterday"), ["2026-11-03", "2026-11-10"]);
});

test("words that only look like dates are ignored", () => {
  assert.deepEqual(days("May I ask what a good CRM is?"), []);
  assert.deepEqual(days("31 February"), []);
  assert.deepEqual(days("How much is Basalt's Pro plan?"), []);
});

test("'today' depends on the user's time zone", () => {
  // 02:00 UTC on 11 Nov is still the evening of 10 Nov in Los Angeles.
  const early = new Date("2026-11-11T02:00:00Z");
  assert.equal(todayIn("America/Los_Angeles", early), "2026-11-10");
  assert.deepEqual(resolveDates("yesterday", { now: early, timeZone: "America/Los_Angeles" }).days, ["2026-11-09"]);
});
