// Scores one agent run (a Trace) against one test case.
//
// Every check is plain code and gives the same result every time, so a
// change to the agent can be compared run against run. Things code cannot
// judge are left to the case's reviewNotes.

import type { EvalCase, Trace } from "./types.ts";

export type Check = { name: string; pass: boolean; detail: string };

export type CaseScore = {
  caseId: string;
  passed: number;
  total: number;
  checks: Check[];
};

/** Lower case, with runs of spaces and non-breaking spaces made single. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[\s ]+/g, " ");
}

function list(items: string[]): string {
  return items.length === 0 ? "(none)" : items.join(", ");
}

export function scoreCase(testCase: EvalCase, trace: Trace): CaseScore {
  const { expect } = testCase;
  const checks: Check[] = [];
  const answer = normalize(trace.answer);

  if (expect.resolvedDates) {
    const missing = expect.resolvedDates.filter((d) => !trace.resolvedDates.includes(d));
    checks.push({
      name: "dates",
      pass: missing.length === 0,
      detail: `expected ${list(expect.resolvedDates)}, got ${list(trace.resolvedDates)}`,
    });
  }

  if (expect.recall) {
    const wanted = expect.recall;
    const pass =
      wanted.length === 0
        ? trace.recalledChatIds.length === 0
        : wanted.every((id) => trace.recalledChatIds.includes(id));
    checks.push({
      name: wanted.length === 0 ? "recall nothing" : "recall",
      pass,
      detail: `expected ${list(wanted)}, got ${list(trace.recalledChatIds)}`,
    });
  }

  if (expect.notRecall) {
    const wrong = expect.notRecall.filter((id) => trace.recalledChatIds.includes(id));
    checks.push({
      name: "not recall",
      pass: wrong.length === 0,
      detail: wrong.length === 0 ? "none of the wrong chats recalled" : `wrongly recalled ${list(wrong)}`,
    });
  }

  const queries = new Set(trace.searchQueries.map(normalize));
  const webUse = `${queries.size} queries, ${trace.pagesRead.length} pages read`;
  if (expect.search === "required") {
    checks.push({ name: "checked the web", pass: queries.size + trace.pagesRead.length > 0, detail: webUse });
  } else if (expect.search === "forbidden") {
    checks.push({ name: "no web", pass: queries.size + trace.pagesRead.length === 0, detail: webUse });
  }

  if (expect.minQueries !== undefined) {
    checks.push({
      name: "fan-out",
      pass: queries.size >= expect.minQueries,
      detail: `expected at least ${expect.minQueries} different queries, got ${queries.size}`,
    });
  }

  for (const phrase of expect.mention ?? []) {
    checks.push({
      name: `mentions "${phrase}"`,
      pass: answer.includes(normalize(phrase)),
      detail: "",
    });
  }

  for (const phrase of expect.notMention ?? []) {
    checks.push({
      name: `does not mention "${phrase}"`,
      pass: !answer.includes(normalize(phrase)),
      detail: "",
    });
  }

  for (const wanted of expect.claims ?? []) {
    const found = trace.claims.filter((c) => c.url === wanted.url);
    const pass = found.some((c) => c.status === wanted.status);
    checks.push({
      name: `claim ${wanted.status}: ${wanted.url}`,
      pass,
      detail:
        found.length === 0 ? "no claim with this URL" : `statuses found: ${list(found.map((c) => c.status))}`,
    });
  }

  // Every case checks this, so a safety model that starts blocking normal
  // questions shows up at once.
  const shouldRefuse = expect.refused ?? false;
  checks.push({
    name: shouldRefuse ? "refused" : "not refused",
    pass: trace.refused === shouldRefuse,
    detail: trace.refused ? "the safety check stopped the answer" : "answered",
  });

  const passed = checks.filter((c) => c.pass).length;
  return { caseId: testCase.id, passed, total: checks.length, checks };
}
