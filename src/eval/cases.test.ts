// Tests for the test set itself.
//
// A typo in the data could make a case impossible to pass, or pass for the
// wrong reason. These tests prove the fake web really says what each case
// expects, so a failing case means the agent is wrong, not the data.

import { test } from "node:test";
import assert from "node:assert/strict";
import { evalCases } from "./cases.ts";
import { EVAL_NOW, pastChats } from "./fixtures/history.ts";
import { fixturePages, pageOn } from "./fixtures/web.ts";

const TODAY = EVAL_NOW.slice(0, 10);
const chatIds = new Set(pastChats.map((c) => c.id));
const pagesByUrl = new Map(fixturePages.map((p) => [p.url, p]));
const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
const amounts = (text: string) => (text.match(/\$[\d,]+(\.\d+)?/g) ?? []).sort();

function duplicates(items: string[]): string[] {
  return items.filter((item, i) => items.indexOf(item) !== i);
}

test("ids and URLs are unique", () => {
  assert.deepEqual(duplicates(evalCases.map((c) => c.id)), []);
  assert.deepEqual(duplicates(pastChats.map((c) => c.id)), []);
  assert.deepEqual(duplicates(fixturePages.map((p) => p.url)), []);
});

test("every URL is on a reserved .example address", () => {
  for (const page of fixturePages) {
    assert.match(new URL(page.url).hostname, /\.example$/, page.url);
  }
});

test("past chats are dated before today, and chat ids match their dates", () => {
  for (const chat of pastChats) {
    assert.ok(isDate(chat.date), chat.id);
    assert.ok(chat.date < TODAY, `${chat.id} is not in the past`);
    assert.ok(chat.id.startsWith(`chat-${chat.date}-`), `${chat.id} does not match ${chat.date}`);
  }
});

test("page versions are valid dates, in order, starting before any use", () => {
  for (const page of fixturePages) {
    const days = page.versions.map((v) => v.from);
    assert.ok(days.every(isDate), page.url);
    assert.deepEqual(days, [...days].sort(), `${page.url} versions are out of order`);
  }
});

test("every saved quote really appears on its page as it was that day", () => {
  for (const chat of pastChats) {
    for (const claim of chat.claims) {
      const page = pagesByUrl.get(claim.url);
      assert.ok(page, `${chat.id}: no fixture page for ${claim.url}`);
      const version = pageOn(page, claim.capturedOn);
      assert.ok(version && version.status === 200, `${claim.url} was not live on ${claim.capturedOn}`);
      assert.ok(version.markdown.includes(claim.quote), `${chat.id}: quote not on page: "${claim.quote}"`);
    }
  }
});

test("cases only refer to chats and pages that exist", () => {
  for (const c of evalCases) {
    for (const id of [...(c.expect.recall ?? []), ...(c.expect.notRecall ?? [])]) {
      assert.ok(chatIds.has(id), `${c.id}: unknown chat ${id}`);
    }
    for (const claim of c.expect.claims ?? []) {
      assert.ok(pagesByUrl.has(claim.url), `${c.id}: unknown page ${claim.url}`);
    }
    for (const d of c.expect.resolvedDates ?? []) {
      assert.ok(isDate(d), `${c.id}: bad date ${d}`);
    }
  }
});

test("a case cannot both require and forbid recalling the same chat", () => {
  for (const c of evalCases) {
    const both = (c.expect.recall ?? []).filter((id) => (c.expect.notRecall ?? []).includes(id));
    assert.deepEqual(both, [], c.id);
  }
});

// The core promise of the test set: each expected claim status is what the
// fake web actually shows today. This is the same rule the agent's checks
// will follow, written down before the agent exists.
test("each expected claim status matches what the fake web shows today", () => {
  for (const c of evalCases) {
    const recalled = pastChats.filter((chat) => (c.expect.recall ?? []).includes(chat.id));
    for (const wanted of c.expect.claims ?? []) {
      const page = pagesByUrl.get(wanted.url);
      assert.ok(page);
      const today = pageOn(page, TODAY);
      const oldClaims = recalled.flatMap((chat) => chat.claims).filter((cl) => cl.url === wanted.url);
      const where = `${c.id} / ${wanted.url}`;

      switch (wanted.status) {
        case "supported":
          assert.equal(today?.status, 200, where);
          break;
        case "same":
          assert.ok(oldClaims.length > 0, `${where}: no old claim to compare`);
          assert.equal(today?.status, 200, where);
          for (const old of oldClaims) assert.ok(today?.markdown.includes(old.quote), `${where}: quote gone`);
          break;
        case "changed":
          assert.ok(oldClaims.length > 0, `${where}: no old claim to compare`);
          assert.equal(today?.status, 200, where);
          assert.ok(
            oldClaims.some((old) => !today?.markdown.includes(old.quote)),
            `${where}: every old quote is still there, so nothing changed`,
          );
          break;
        case "was-wrong":
          assert.ok(oldClaims.length > 0, `${where}: no old claim to compare`);
          assert.ok(
            oldClaims.some((old) => amounts(old.text).join() !== amounts(old.quote).join()),
            `${where}: the old claim matches its own quote, so it was not wrong`,
          );
          break;
        case "cannot-confirm":
          assert.ok(today === null || today.status !== 200, `${where}: the page is still live`);
          break;
      }
    }
  }
});
