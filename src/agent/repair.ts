// A repair round that fixes only what failed.
//
// Re-writing the whole answer to fix two facts was the slowest part of a
// turn: a live run spent 90 seconds on it, most of it the model thinking
// through the whole answer again. Instead the model gets its own draft and
// the failures, and sends back only the changes:
//   - edits: exact pieces of the answer text and what replaces them,
//   - claims: fixed versions of failing facts, by number, or "remove".
//
// Code applies them. An edit is applied only if its text appears exactly
// once in the answer; anything else means the reply cannot be trusted, and
// the turn falls back to a full re-write, as before.

import type { ChatMessage } from "../model/types.ts";
import type { Evidence } from "../search/tool.ts";
import { parseAnswer, type FinalClaim, type ParsedAnswer } from "./answer.ts";
import type { OldClaimCheck } from "./claim-checks.ts";
import { answerRules, CLAIM_FIELDS, longDate, type Brief } from "./prompts.ts";

const CLAIM_PROPERTIES = {
  text: { type: "string" },
  topic: { type: "string" },
  source: { type: ["integer", "null"] },
  quote: { type: "string" },
  status: { type: "string", enum: ["supported", "same", "changed", "was-wrong", "cannot-confirm"] },
  oldClaim: { type: ["string", "null"] },
} as const;

export const REPAIR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["edits", "claims"],
  properties: {
    edits: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["find", "replace"],
        properties: { find: { type: "string" }, replace: { type: "string" } },
      },
    },
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["number", "remove", ...Object.keys(CLAIM_PROPERTIES)],
        properties: { number: { type: "integer" }, remove: { type: "boolean" }, ...CLAIM_PROPERTIES },
      },
    },
  },
} as const;

export function repairSystemPrompt(brief: Brief): string {
  return [
    `You are minimi, a chat assistant. You wrote the draft below, and the app's checks found problems in it. Fix only those problems. Do not rewrite the rest.`,
    `Today is ${longDate(brief.now, brief.timeZone)}.`,
    answerRules(),
    [
      `Reply as JSON:`,
      `- edits: changes to the answer text. find: words copied exactly from the draft answer, long enough to appear only once. replace: what goes there instead. Use edits to fix a wrong number, add a missing value, or remove a statement the evidence cannot support.`,
      `- claims: one entry per claim you change, by its number in the list below.`,
      `  - number: the claim's number. Use 0 to add a new claim.`,
      `  - remove: true to drop the claim. Also remove or soften its statement in the answer with an edit.`,
      ...CLAIM_FIELDS,
      `Leave out anything that needs no change.`,
    ].join("\n"),
  ].join("\n\n");
}

/** The draft, with each claim numbered, for the repair step to refer to. */
export function draftSection(draft: ParsedAnswer): string {
  const claims = draft.claims.map((c, i) =>
    JSON.stringify({ number: i + 1, text: c.text, topic: c.topic, source: c.source, quote: c.quote, status: c.status, oldClaim: c.oldClaim }),
  );
  return `## Your draft answer\n${draft.answer}\n\n## Its claims\n${claims.join("\n") || "None."}`;
}

export function repairMessages(brief: Brief, writerBriefText: string, draft: ParsedAnswer): ChatMessage[] {
  return [
    { role: "system", content: repairSystemPrompt(brief) },
    { role: "user", content: `${writerBriefText}\n\n${draftSection(draft)}` },
  ];
}

type RawEdit = { find?: unknown; replace?: unknown };
type RawFix = Record<string, unknown> & { number?: unknown; remove?: unknown };

/**
 * Applies a repair reply to the draft. Returns null when it cannot be
 * applied safely, so the caller re-writes instead.
 */
export function applyRepair(
  draft: ParsedAnswer,
  reply: string,
  evidence: Evidence[],
  oldChecks: OldClaimCheck[],
  today: string,
): ParsedAnswer | null {
  let data: { edits?: unknown; claims?: unknown };
  try {
    data = JSON.parse(reply.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")) as typeof data;
  } catch {
    return null;
  }
  if (!Array.isArray(data.edits) || !Array.isArray(data.claims)) return null;

  let answer = draft.answer;
  for (const edit of data.edits as RawEdit[]) {
    if (typeof edit.find !== "string" || typeof edit.replace !== "string" || edit.find === "") return null;
    if (answer.split(edit.find).length !== 2) return null; // Not found, or not once.
    answer = answer.replace(edit.find, () => edit.replace as string);
  }
  if (answer.trim() === "") return null;

  const claims: (FinalClaim | null)[] = [...draft.claims];
  const added: FinalClaim[] = [];
  const problems: string[] = [];
  for (const fix of data.claims as RawFix[]) {
    const number = typeof fix.number === "number" && Number.isInteger(fix.number) ? fix.number : -1;
    if (number < 0 || number > claims.length) return null;
    if (fix.remove === true) {
      if (number === 0) continue;
      claims[number - 1] = null;
      continue;
    }
    // The writer's own reader turns the fixed claim into a final one, with
    // the same rules: real evidence numbers, the app's status for old claims.
    const { number: _n, remove: _r, ...raw } = fix;
    const parsed = parseAnswer(JSON.stringify({ answer: "-", claims: [raw] }), evidence, oldChecks, today);
    problems.push(...(parsed?.problems ?? []));
    const claim = parsed?.claims[0];
    if (!claim) continue;
    if (number === 0) added.push(claim);
    else claims[number - 1] = claim;
  }
  return {
    answer: answer.trim(),
    claims: [...claims.filter((c): c is FinalClaim => c !== null), ...added],
    problems,
  };
}
