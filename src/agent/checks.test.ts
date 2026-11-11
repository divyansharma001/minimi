import { test } from "node:test";
import assert from "node:assert/strict";
import { asksAboutNow, choosePath, isSmallTalk } from "./intent.ts";
import { checkOldClaims, numbersAgree, numbersIn, quoteOnPage } from "./claim-checks.ts";
import type { Snapshot } from "../search/snapshots.ts";
import type { StoredClaim } from "../memory/types.ts";

test("small talk is only short, plain pleasantries", () => {
  assert.equal(isSmallTalk("Thanks, that's really helpful!"), true);
  assert.equal(isSmallTalk("hi"), true);
  assert.equal(isSmallTalk("Thanks! Now what does Neon cost?"), false);
  assert.equal(isSmallTalk("ok so compare the CRM tools again for a 50 person team please"), false);
});

test("the brief's questions take the right path", () => {
  const path = (message: string, refersToPast = true) => choosePath(message, refersToPast);
  assert.equal(path("What did I ask you on 3 November?"), "memory");
  assert.equal(path("What did we talk about last week?"), "memory");
  assert.equal(path("What did I ask you on 3 November? Is your answer still correct today?"), "research");
  assert.equal(path("Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?"), "research");
  assert.equal(path("On Monday we shortlisted 5 CRM tools. Has any of them changed pricing or shipped something big since?"), "research");
  assert.equal(path("On 20 October you told me Fernwood's Team plan price. Was that right?"), "research");
  assert.equal(path("How much is Basalt's Pro plan?", false), "research");
  assert.equal(path("Thanks, that's really helpful!", false), "talk");
});

test("asking about now is spotted in its common forms", () => {
  for (const m of ["Is it still true?", "what's the latest", "any update?", "has the price changed"]) {
    assert.equal(asksAboutNow(m), true, m);
  }
  assert.equal(asksAboutNow("What did I ask you yesterday?"), false);
});

test("quotes match through Markdown, table pipes, spacing and curly quotes, not through different words", () => {
  const page = "| Plan | Price |\n| --- | --- |\n| **Team:** $29 per user / month | Billed monthly |";
  assert.equal(quoteOnPage("Team: $29 per user / month", page), true);
  assert.equal(quoteOnPage("Team: $19 per user / month", page), false);
  assert.equal(quoteOnPage("It’s free", "it's free to try"), true);
  assert.equal(quoteOnPage("$29", page), false, "a quote too short to mean anything never counts");
});

test("numbers are compared without commas, and every claim number must be in its quote", () => {
  assert.deepEqual(numbersIn("Voltaro City: $1,799.00 or 2 for $3,500"), ["1799.00", "2", "3500"]);
  assert.equal(numbersAgree("Fernwood Team costs $19 per user per month", "Team: $29 per user / month"), false);
  assert.equal(numbersAgree("Basalt Pro costs $69 per month", "Pro: $69 / month"), true);
});

const claim = (text: string, quote: string, url: string): StoredClaim => ({
  text, quote, url, capturedOn: "2026-11-03", status: "supported",
});
const copy = (url: string, status: number, markdown: string): Snapshot => ({
  id: `snap-${url}`, url, finalUrl: url, day: "2026-11-11", fetchedAt: "", status, title: "", markdown, hash: "",
});

test("old claims get the status the evidence settles, and the model decides only what it must", () => {
  const checks = checkOldClaims(
    [
      { chatId: "c", claim: claim("Basalt Starter costs $19 per month", "Starter: $19 / month", "https://basalt.example/pricing") },
      { chatId: "c", claim: claim("Basalt Pro costs $69 per month", "Pro: $69 / month", "https://basalt.example/pricing") },
      { chatId: "c", claim: claim("Quillgres Dev costs $15 per month", "Dev plan: $15 / month", "https://quillgres.example/pricing") },
      { chatId: "c", claim: claim("Fernwood Team costs $19", "Team: $29 per user / month", "https://fernwood.example/pricing") },
      { chatId: "c", claim: claim("Voltaro City costs $1,799", "Voltaro City: $1,799", "https://voltaro.example/city") },
    ],
    new Map([
      ["https://basalt.example/pricing", copy("https://basalt.example/pricing", 200, "- Starter: $19 / month\n- Pro: $79 / month")],
      ["https://quillgres.example/pricing", copy("https://quillgres.example/pricing", 404, "# 404")],
      ["https://fernwood.example/pricing", copy("https://fernwood.example/pricing", 200, "Team: $29 per user / month")],
    ]),
  );
  assert.deepEqual(
    checks.map((c) => [c.ref, c.today, c.status]),
    [
      ["O1", "on-page", "same"],
      ["O2", "gone-from-page", "changed"],
      ["O3", "page-gone", "cannot-confirm"],
      ["O4", "on-page", "was-wrong"],
      ["O5", "not-read", null],
    ],
  );
});
