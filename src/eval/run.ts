// Plays the test set through the real model, against the fake web and a
// fixed clock, and scores every answer.
//
//   npm run eval                      all cases
//   npm run eval -- --case date-yesterday --case fresh-question
//
// Costs real model tokens (cents per run) and no search credits: the fake web
// stands in for Tavily. Results are saved to eval-results/ for comparison.

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { readConfig } from "../config/env.ts";
import { MemoryStore } from "../memory/store.ts";
import { OpenRouterClient } from "../model/openrouter.ts";
import { SnapshotStore } from "../search/snapshots.ts";
import { runTurn } from "../agent/turn.ts";
import { evalCases } from "./cases.ts";
import { EVAL_NOW, EVAL_TIME_ZONE } from "./fixtures/history.ts";
import { fixturePages } from "./fixtures/web.ts";
import { FixtureWeb } from "./fixture-web.ts";
import { loadPastChats } from "./load-fixtures.ts";
import { scoreCase } from "./score.ts";
import type { EvalCase } from "./types.ts";

const { values } = parseArgs({
  options: { case: { type: "string", multiple: true }, concurrency: { type: "string", default: "3" } },
});

const config = readConfig(process.env);
if (!config.ok) {
  console.error(config.problems.join("\n"));
  process.exit(1);
}
const model = new OpenRouterClient(config.config.openRouterApiKey, config.config.model);
const guard = config.config.guardModel
  ? new OpenRouterClient(config.config.openRouterApiKey, config.config.guardModel)
  : undefined;
const today = EVAL_NOW.slice(0, 10);
const now = () => new Date(EVAL_NOW);

const selected = values.case?.length ? evalCases.filter((c) => values.case?.includes(c.id)) : evalCases;
if (selected.length === 0) {
  console.error(`No case matches. Cases: ${evalCases.map((c) => c.id).join(", ")}`);
  process.exit(1);
}

async function runCase(testCase: EvalCase) {
  const store = (await MemoryStore.open(await mkdtemp(join(tmpdir(), "minimi-eval-")))).store;
  await loadPastChats(store);
  const web = new FixtureWeb(fixturePages, today);
  const snapshots = (await SnapshotStore.open(await mkdtemp(join(tmpdir(), "minimi-eval-pages-")))).store;

  let chatId: string | undefined;
  if (testCase.earlierTurns?.length) {
    const first = testCase.earlierTurns[0]?.text ?? "";
    const chat = await store.createChat({ firstMessage: first, at: EVAL_NOW, day: today });
    for (const t of testCase.earlierTurns) await store.addTurn(chat.id, { role: t.role, text: t.text, at: EVAL_NOW, day: today });
    chatId = chat.id;
  }

  const result = await runTurn(
    { ...(chatId ? { chatId } : {}), message: testCase.question },
    { model, ...(guard ? { guard } : {}), store, search: { backend: web, fetcher: web, snapshots, now, timeZone: EVAL_TIME_ZONE }, now, timeZone: EVAL_TIME_ZONE },
  );
  return { testCase, result, score: scoreCase(testCase, result.trace) };
}

async function inBatches<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += size) results.push(...(await Promise.all(items.slice(i, i + size).map(work))));
  return results;
}

const started = Date.now();
console.log(`Running ${selected.length} case(s) on ${config.config.model}, as of ${EVAL_NOW}\n`);
const runs = await inBatches(selected, Math.max(1, Number(values.concurrency)), runCase);

const pad = (text: string, width: number) => text.slice(0, width).padEnd(width);
for (const { testCase, result, score } of runs) {
  const mark = score.passed === score.total ? "PASS" : "FAIL";
  console.log(
    `${mark}  ${pad(testCase.id, 32)} ${String(score.passed).padStart(2)}/${String(score.total).padEnd(2)}  ` +
      `${(result.trace.timings.totalMs / 1000).toFixed(1).padStart(5)}s  $${result.usage.cost.toFixed(4)}  ` +
      `${result.usage.modelCalls} calls  ${result.trace.searchQueries.length} queries  ${result.trace.pagesRead.length} pages  [${result.trace.refused ? "refused" : result.path}]`,
  );
  for (const check of score.checks.filter((c) => !c.pass)) console.log(`        x ${check.name}${check.detail ? `: ${check.detail}` : ""}`);
  for (const problem of result.problems) console.log(`        ! ${problem}`);
}

const checks = runs.reduce((n, r) => n + r.score.total, 0);
const passedChecks = runs.reduce((n, r) => n + r.score.passed, 0);
const fullCases = runs.filter((r) => r.score.passed === r.score.total).length;
const cost = runs.reduce((n, r) => n + r.result.usage.cost, 0);
const times = runs.map((r) => r.result.trace.timings.totalMs).sort((a, b) => a - b);
const median = times[Math.floor(times.length / 2)] ?? 0;

console.log(
  `\nCases fully passed: ${fullCases}/${runs.length}   Checks passed: ${passedChecks}/${checks}` +
    `   Median time: ${(median / 1000).toFixed(1)}s   Total cost: $${cost.toFixed(4)}   Wall time: ${((Date.now() - started) / 1000).toFixed(0)}s`,
);

await mkdir("eval-results", { recursive: true });
const file = join("eval-results", `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
await writeFile(
  file,
  JSON.stringify(
    {
      model: config.config.model,
      ranAt: new Date().toISOString(),
      summary: { fullCases, cases: runs.length, passedChecks, checks, medianMs: median, cost },
      runs: runs.map(({ testCase, result, score }) => ({
        id: testCase.id,
        score,
        path: result.path,
        answer: result.answer,
        claims: result.claims,
        trace: result.trace,
        usage: result.usage,
        problems: result.problems,
      })),
    },
    null,
    2,
  ),
);
console.log(`Saved ${file}`);
