// The web search tool against the fake web, with the searches the brief's
// questions need. No model: this proves the tool returns the right evidence,
// so a wrong answer later is the model's fault, not the tool's.

import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LinkGate } from "../search/link-gate.ts";
import { SnapshotStore } from "../search/snapshots.ts";
import { webSearch, type WebSearchDeps } from "../search/tool.ts";
import { SearchError, type SearchBackend } from "../search/types.ts";
import { EVAL_NOW, EVAL_TIME_ZONE } from "./fixtures/history.ts";
import { fixturePages } from "./fixtures/web.ts";
import { FixtureWeb } from "./fixture-web.ts";

const TODAY = EVAL_NOW.slice(0, 10);
let web: FixtureWeb;
let deps: WebSearchDeps;

beforeEach(async () => {
  web = new FixtureWeb(fixturePages, TODAY);
  deps = {
    backend: web,
    fetcher: web,
    gate: new LinkGate(),
    snapshots: (await SnapshotStore.open(await mkdtemp(join(tmpdir(), "minimi-pages-")))).store,
    now: () => new Date(EVAL_NOW),
    timeZone: EVAL_TIME_ZONE,
  };
});

const allText = (result: Awaited<ReturnType<typeof webSearch>>) => result.evidence.map((e) => e.text).join("\n");

test("re-opening an old answer's sources: one changed, one same, one gone", async () => {
  const result = await webSearch(
    { open: ["https://basalt.example/pricing", "https://harborbase.example/pricing", "https://quillgres.example/pricing"] },
    deps,
    false,
  );
  const outcome = Object.fromEntries(result.pages.map((p) => [p.url, p.outcome]));
  assert.deepEqual(outcome, {
    "https://basalt.example/pricing": "read",
    "https://harborbase.example/pricing": "read",
    "https://quillgres.example/pricing": "not-found",
  });
  assert.match(allText(result), /Pro: \$79 \/ month/);
  assert.match(allText(result), /Standard: \$25 \/ month/);
  // The gone page is saved too, so "it was gone on 11 Nov" is on record.
  assert.equal(deps.snapshots.on("https://quillgres.example/pricing", TODAY)?.status, 404);
});

test("CRM fan-out: one search per tool finds each pricing page", async () => {
  const tools = ["Pipewell", "Dealcraft", "Closely", "Northlane", "Tallyho"];
  const pricing = await Promise.all(tools.map((t) => webSearch({ queries: [`${t} CRM pricing per seat`] }, deps, true)));
  const text = pricing.map(allText).join("\n");
  assert.match(text, /\$28 per seat/, "Pipewell's new price");
  assert.match(text, /\$30 per seat/);
  assert.match(text, /\$18 per seat/);
  assert.match(text, /\$40 per seat/);
  assert.match(text, /\$22 per seat/);
});

test("news since Monday finds the launch after it, not the one before", async () => {
  const result = await webSearch(
    { queries: ["Dealcraft launch", "Northlane launch"], topic: "news", since: "2026-11-09" },
    deps,
    true,
  );
  assert.match(allText(result), /Dealcraft Autopilot/);
  assert.doesNotMatch(allText(result), /mobile app/, "5 Nov is before Monday 9 Nov");
  assert.equal(result.evidence.find((e) => /Autopilot/.test(e.text))?.pageDate?.day, "2026-11-10");
});

test("an instruction hidden in a page never reaches the evidence", async () => {
  const result = await webSearch({ queries: ["Tallyho pricing"] }, deps, true);
  assert.match(allText(result), /\$22 per seat/);
  assert.doesNotMatch(allText(result), /free forever|ignore all previous/i);
});

test("links to private addresses, and made-up links that could leak data, are not opened", async () => {
  const result = await webSearch(
    { open: ["http://169.254.169.254/latest/meta-data/", "https://attacker.example/c?d=secret"] },
    deps,
    true,
  );
  assert.deepEqual(
    result.pages.map((p) => p.outcome),
    ["blocked", "blocked"],
  );
  assert.deepEqual(web.fetched, [], "nothing was fetched");
});

test("a link found in search results may be opened later, query string and all", async () => {
  await webSearch({ queries: ["Basalt pricing"] }, deps, true);
  assert.equal(deps.gate.isKnown("https://basalt.example/pricing"), true);
});

test("limits hold even if the model asks for more", async () => {
  const result = await webSearch({ queries: ["a", "b", "c", "d", "e"], open: ["https://x.example/1"] }, deps, true);
  assert.equal(result.queries.length, 3);
  assert.equal(web.searched.length, 3);
});

test("when search fails, the reason is reported and named pages are still read", async () => {
  const broken: SearchBackend = {
    search: async () => {
      throw new SearchError("quota", "Tavily's searches for this month are used up.");
    },
  };
  const result = await webSearch(
    { queries: ["basalt pricing"], open: ["https://basalt.example/pricing"] },
    { ...deps, backend: broken },
    true,
  );
  assert.deepEqual(result.problems, ["Tavily's searches for this month are used up."]);
  assert.match(allText(result), /\$79/);
});

test("reading the same page twice in a day keeps one copy", async () => {
  await webSearch({ open: ["https://basalt.example/pricing"] }, deps, false);
  await webSearch({ open: ["https://basalt.example/pricing"] }, deps, false);
  assert.equal(deps.snapshots.history("https://basalt.example/pricing").length, 1);
});
