import { test } from "node:test";
import assert from "node:assert/strict";
import { rankPassages, splitPassages } from "./passages.ts";

test("each passage keeps the heading it sits under", () => {
  const passages = splitPassages("# Pricing\n\nStarter is cheap.\n\n## Support\n\nEmail only.");
  assert.deepEqual(passages, [
    { heading: "Pricing", text: "Starter is cheap." },
    { heading: "Support", text: "Email only." },
  ]);
});

test("a long table is split by rows, with the header row on every piece", () => {
  const rows = Array.from({ length: 40 }, (_, i) => `| Plan ${i} | $${i * 10} / month |`);
  const markdown = ["# Plans", "", "| Plan | Price |", "| --- | --- |", ...rows].join("\n");
  const passages = splitPassages(markdown, 300);
  assert.ok(passages.length > 1);
  for (const p of passages) {
    assert.ok(p.text.startsWith("| Plan | Price |\n| --- | --- |"), p.text);
    assert.ok(p.text.length <= 300 + 40, `too long: ${p.text.length}`);
  }
  const allRows = passages.flatMap((p) => p.text.split("\n").slice(2));
  assert.deepEqual(allRows, rows, "no row lost or repeated");
});

test("long paragraphs split at sentence ends, short ones are joined", () => {
  const long = "This is one sentence about plans. ".repeat(40);
  const pieces = splitPassages(long, 200);
  assert.ok(pieces.length > 1);
  assert.ok(pieces.every((p) => p.text.length <= 200));
  const joined = splitPassages("One.\n\nTwo.\n\nThree.");
  assert.equal(joined.length, 1);
});

const pages = [
  {
    url: "https://basalt.example/pricing",
    title: "Basalt Postgres pricing",
    mustInclude: false,
    passages: [
      { heading: "Basalt", text: "Starter: $19 / month. Pro: $79 / month." },
      { heading: "Support", text: "Email support on all plans." },
    ],
  },
  {
    url: "https://reviews.example/postgres",
    title: "Postgres hosting reviews",
    mustInclude: false,
    passages: [{ heading: "Review", text: "Basalt pricing is fair. Pro costs more than most." }],
  },
  {
    url: "https://quillgres.example/pricing",
    title: "Page not found",
    mustInclude: true,
    passages: [{ heading: "404", text: "This page could not be found." }],
  },
];

test("the official site wins over a review of it", () => {
  const ranked = rankPassages("basalt pro pricing", pages);
  assert.equal(ranked.find((r) => r.score > 0)?.url, "https://basalt.example/pricing");
});

test("a page asked for by name is always included, even with no matching words", () => {
  const ranked = rankPassages("basalt pro pricing", pages);
  assert.ok(ranked.some((r) => r.url === "https://quillgres.example/pricing"));
});

test("passages with no matching words are dropped, and one page cannot crowd out the rest", () => {
  const ranked = rankPassages("basalt pricing", pages, { perPage: 1 });
  assert.ok(!ranked.some((r) => r.passage.heading === "Support"));
  assert.equal(ranked.filter((r) => r.url === "https://basalt.example/pricing").length, 1);
});

test("with no query, a page opened by name shows its passages in page order", () => {
  const page = {
    url: "https://harborbase.example/pricing",
    title: "Harborbase pricing",
    mustInclude: true,
    passages: [
      { heading: "", text: "Black Friday early access is live." },
      { heading: "Harborbase", text: "Hobby: $0 / month. Standard: $25 / month." },
      { heading: "Harborbase", text: "Need more? Talk to sales." },
      { heading: "", text: "Footer" },
    ],
  };
  const ranked = rankPassages("", [page], { perPage: 3 });
  assert.deepEqual(
    ranked.map((r) => r.passage.text),
    page.passages.slice(0, 3).map((p) => p.text),
  );
});
