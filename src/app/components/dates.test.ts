import { test } from "node:test";
import assert from "node:assert/strict";
import { groupLabel, shortDay } from "./dates.ts";

const today = "2026-11-11"; // a Wednesday

test("sidebar groups read like a person would say them", () => {
  assert.equal(groupLabel("2026-11-11", today), "Today");
  assert.equal(groupLabel("2026-11-10", today), "Yesterday");
  assert.equal(groupLabel("2026-11-09", today), "Monday");
  assert.equal(groupLabel("2026-11-05", today), "Thursday");
  assert.equal(groupLabel("2026-11-04", today), "4 Nov", "a week ago is a date, so two Wednesdays never share a name");
  assert.equal(groupLabel("2025-12-30", today), "30 Dec 2025");
});

test("short dates add the year only when it differs", () => {
  assert.equal(shortDay("2026-11-03", today), "3 Nov");
  assert.equal(shortDay("2025-11-03", today), "3 Nov 2025");
  assert.equal(shortDay("not a date", today), "not a date");
});
