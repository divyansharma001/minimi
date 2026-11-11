import { test } from "node:test";
import assert from "node:assert/strict";
import { KeywordIndex, stem, terms } from "./keywords.ts";

test("stems match the common forms of a word", () => {
  assert.equal(stem("hosting"), stem("host"));
  assert.equal(stem("pricing"), stem("price"));
  assert.equal(stem("companies"), stem("company"));
  assert.equal(stem("shortlisted"), stem("shortlist"));
  assert.equal(stem("tools"), stem("tool"));
  assert.equal(stem("postgres"), stem("Postgres".toLowerCase()));
  assert.equal(stem("class"), "class");
});

test("only topic words are kept", () => {
  const words = terms("What did I ask you about Postgres hosting last Tuesday?").map((t) => t.word);
  assert.deepEqual(words, ["postgres", "hosting"]);
});

const index = new KeywordIndex([
  { id: "postgres", text: "Compare managed Postgres hosting for a small SaaS. Basalt, Harborbase and Quillgres pricing." },
  { id: "crm", text: "Shortlist 5 CRM tools with per-seat pricing for a 20-person sales team." },
  { id: "ebikes", text: "What's a good city e-bike under $2,000? The Voltaro City." },
]);

test("a rare word beats a common one", () => {
  const hits = index.search(terms("postgres pricing"));
  assert.equal(hits[0]?.id, "postgres");
  assert.deepEqual(hits[0]?.matched, ["postgres", "pricing"]);
  assert.equal(hits[1]?.id, "crm");
  assert.ok((hits[0]?.score ?? 0) > (hits[1]?.score ?? 0));
});

test("documents with no matching word are left out", () => {
  assert.deepEqual(
    index.search(terms("redis")).map((h) => h.id),
    [],
  );
});

test("a search can be limited to some documents", () => {
  const hits = index.search(terms("pricing"), { only: new Set(["crm", "ebikes"]) });
  assert.deepEqual(
    hits.map((h) => h.id),
    ["crm"],
  );
});

test("an empty index or an empty query returns nothing", () => {
  assert.deepEqual(new KeywordIndex([]).search(terms("anything")), []);
  assert.deepEqual(index.search([]), []);
});
