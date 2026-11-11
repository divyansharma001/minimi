// Sources that disagree, found in code.
//
// The writer names what each fact is about (its topic). Code then decides
// whether facts on the same topic really disagree:
//   - at least two different websites,
//   - each fact passed its own checks (its quote is on its page),
//   - and their numbers differ. Years are left out: "2026 pricing" on one
//     page and "2025 pricing" on another is not a disagreement about a price.
//
// Only numbers are compared. Two wordings of the same fact always differ as
// text, so text alone cannot prove a disagreement; the writer's rule covers
// those in the prose.
//
// When the answer text leaves out one side's value, the writer is asked to
// give both, since picking one silently is exactly what this guards against.

import type { FinalClaim } from "./answer.ts";
import { normalizeText, numbersIn } from "./claim-checks.ts";
import { siteName, type ClaimProblem } from "./verify.ts";
import type { Evidence } from "../search/tool.ts";

export type ConflictGroup = {
  /** 1, 2, ... in order of first appearance. */
  id: number;
  topic: string;
  claims: FinalClaim[];
};

const YEAR = /^(19|20)\d\d$/;

/** The numbers a fact turns on, as a key: "$11 per user" -> "11". */
function valueKey(claim: FinalClaim): string {
  return numbersIn(claim.text)
    .filter((n) => !YEAR.test(n))
    .sort()
    .join("|");
}

const topicKey = (topic: string) => normalizeText(topic).replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

export function findConflicts(claims: FinalClaim[]): ConflictGroup[] {
  const byTopic = new Map<string, FinalClaim[]>();
  for (const claim of claims) {
    // Only new facts with a page behind them can disagree with each other.
    if (claim.status !== "supported" || claim.url === "" || claim.oldClaim !== null) continue;
    const key = topicKey(claim.topic);
    if (key === "" || valueKey(claim) === "") continue;
    byTopic.set(key, [...(byTopic.get(key) ?? []), claim]);
  }

  const groups: ConflictGroup[] = [];
  for (const group of byTopic.values()) {
    // Two facts with different values from different sites. One page listing
    // a monthly and an annual price is not a disagreement.
    const disagree = group.some((a) =>
      group.some((b) => valueKey(a) !== valueKey(b) && siteName(a.url) !== siteName(b.url)),
    );
    if (disagree) {
      groups.push({ id: groups.length + 1, topic: group[0]?.topic ?? "", claims: group });
    }
  }
  return groups;
}

/** Marks each claim with its conflict group, or null. */
export function withConflicts(claims: FinalClaim[], groups: ConflictGroup[]): FinalClaim[] {
  return claims.map((claim) => ({ ...claim, conflict: groups.find((g) => g.claims.includes(claim))?.id ?? null }));
}

/**
 * The answer must show every side of a disagreement. A side counts as shown
 * when its first number appears in the answer text.
 */
export function checkConflictsShown(groups: ConflictGroup[], answer: string, evidence: Evidence[]): ClaimProblem[] {
  const shown = new Set(numbersIn(answer));
  const problems: ClaimProblem[] = [];
  for (const group of groups) {
    const sides = [...new Map(group.claims.map((c) => [valueKey(c), c])).values()];
    const hidden = sides.filter((c) => {
      const first = numbersIn(c.text).find((n) => !YEAR.test(n));
      return first !== undefined && !shown.has(first);
    });
    if (hidden.length === 0) continue;
    const official = group.claims.some((c) => c.source !== null && evidence[c.source - 1]?.official);
    const list = sides.map((c) => `[${c.source}] says "${c.text}"`).join("; ");
    problems.push({
      claim: hidden[0] as FinalClaim,
      kind: "soft",
      reason: `sources disagree on "${group.topic}": ${list}. Give every value with its source, and say which is more reliable and why`,
      // Without the company's own page, one more search may settle it.
      ...(official ? {} : { research: true }),
    });
  }
  return problems;
}
