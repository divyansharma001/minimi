import { test } from "node:test";
import assert from "node:assert/strict";
import { checkClaims, siteName } from "./verify.ts";
import type { FinalClaim } from "./answer.ts";
import type { Evidence } from "../search/tool.ts";
import type { OldClaimCheck } from "./claim-checks.ts";

const page = (url: string, text: string, extra: Partial<Evidence> = {}): Evidence => ({
  url, title: "", heading: "", text, readOn: "2026-11-11", snippetOnly: false, ...extra,
});

// The passage the model saw is short; the saved page is longer.
const fullPages: Record<string, string> = {
  "https://neon.com/pricing": "# Neon pricing\n\nLaunch: $0.106 per CU-hour\n\nScale: $0.222 per CU-hour",
  "https://blog.example/neon": "Neon pricing explained. Launch: $0.106 per CU-hour. Updated 2026-11-02.",
};
const evidence = [
  page("https://neon.com/pricing", "Launch: $0.106 per CU-hour"),
  page("https://blog.example/neon", "Launch: $0.106 per CU-hour", { pageDate: { day: "2026-11-02", kind: "updated", foundIn: "page-meta" } }),
];
const pageText = (e: Evidence) => fullPages[e.url] ?? e.text;

const claim = (overrides: Partial<FinalClaim>): FinalClaim => ({
  text: "Neon Launch costs $0.106 per CU-hour",
  topic: "Neon Launch compute price",
  conflict: null,
  quote: "Launch: $0.106 per CU-hour",
  url: "https://neon.com/pricing",
  status: "supported",
  source: 1,
  oldClaim: null,
  readOn: "2026-11-11",
  ...overrides,
});

const check = (claims: FinalClaim[], old: OldClaimCheck[] = []) =>
  checkClaims(claims, evidence, old, pageText, "2026-11-11").map((p) => `${p.kind}: ${p.reason}`);

test("a claim whose quote is on its page and whose numbers are in the quote passes", () => {
  assert.deepEqual(check([claim({})]), []);
});

test("the quote is checked against the full saved page, not only the passage shown", () => {
  assert.deepEqual(check([claim({ text: "Neon Scale costs $0.222 per CU-hour", quote: "Scale: $0.222 per CU-hour" })]), []);
});

test("a quote that is not on the page fails", () => {
  assert.deepEqual(check([claim({ quote: "Launch: $0.099 per CU-hour" })]), [
    "hard: its quote is not on the page it cites, [1]",
  ]);
});

test("a number in the claim that is not in its quote fails", () => {
  assert.deepEqual(check([claim({ text: "Neon Launch costs $0.106 per CU-hour, or about $78 a month" })]), [
    "hard: 78 is not in its quote",
  ]);
});

test("dates the app knows may be mentioned without a quote", () => {
  assert.deepEqual(check([claim({ text: "As of 11 November 2026, Neon Launch costs $0.106 per CU-hour" })]), []);
  assert.deepEqual(
    check([claim({ text: "Neon Launch was $0.106 per CU-hour on 2 November", source: 2, url: "https://blog.example/neon" })]),
    ["soft: [1] is the official page and says the same thing; cite it instead of [2]"],
  );
});

test("missing source or quote fails", () => {
  assert.deepEqual(check([claim({ source: null })]), ["hard: it cites no evidence"]);
  assert.deepEqual(check([claim({ quote: "" })]), ["hard: it cites [1] but gives no quote"]);
  assert.deepEqual(check([claim({ source: 9 })]), ["hard: it cites no evidence"]);
});

test("citing a copy when the official page says the same is a soft problem", () => {
  assert.deepEqual(check([claim({ source: 2, url: "https://blog.example/neon" })]), [
    "soft: [1] is the official page and says the same thing; cite it instead of [2]",
  ]);
});

test("a copy is fine when the official page does not carry the quote", () => {
  const onlyBlog = [evidence[1] as Evidence];
  const problems = checkClaims([claim({ source: 1, url: "https://blog.example/neon" })], onlyBlog, [], pageText, "2026-11-11");
  assert.deepEqual(problems, []);
});

test("a changed claim may name the old value from its old quote", () => {
  const old: OldClaimCheck = {
    ref: "O1",
    chatId: "c",
    claim: { text: "Neon Launch was $0.090", quote: "Launch: $0.090 per CU-hour", url: "https://neon.com/pricing", capturedOn: "2026-11-03", status: "supported" },
    today: "gone-from-page",
    matchedOwnQuote: true,
    status: "changed",
  };
  assert.deepEqual(
    check([claim({ text: "Neon Launch went from $0.090 on 3 Nov to $0.106 per CU-hour", status: "changed", oldClaim: "O1" })], [old]),
    [],
  );
});

test("statuses settled by code, and claims asserting nothing, are not re-checked", () => {
  assert.deepEqual(check([claim({ status: "cannot-confirm", source: null, quote: "" })]), []);
});

test("site names ignore subdomains and www", () => {
  assert.equal(siteName("https://www.neon.com/pricing"), "neon");
  assert.equal(siteName("https://docs.neon.tech/x"), "neon");
  assert.equal(siteName("https://basalt.example/pricing"), "basalt");
});
