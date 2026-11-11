// Sources that disagree, found in code.
//
// The writer names what each fact is about (its topic). Code then decides
// whether facts on the same topic really disagree:
//   - they come from different websites,
//   - each passed its own checks (its quote is on its page),
//   - and their values clash: neither fact's values all appear in the other's.
//     "EOL 30 April 2027" and "in maintenance since October 2025, EOL
//     2027-04-30" agree: one just says more. "$11" and "$9" clash.
//
// A fact's values are its numbers and dates. Dates are read as dates, so
// "April 30, 2028", "30 April 2028" and "2028-04-30" are one value, and a
// date without a year matches one with it. Bare years and numbers from the
// topic itself (the "24" in "Node.js 24") are not values.
//
// Only values are compared. Two wordings of the same fact always differ as
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
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
const ORD = "(?:st|nd|rd|th)?";

/** Date patterns, longest first, each read into year, month and day. */
const DATES: { pattern: RegExp; read: (m: RegExpExecArray) => [string?, string?, string?] }[] = [
  { pattern: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, read: (m) => [m[1], m[2], m[3]] },
  { pattern: new RegExp(`\\b(\\d{1,2})${ORD}\\s+${MONTH},?\\s+(\\d{4})\\b`, "gi"), read: (m) => [m[3], m[2], m[1]] },
  { pattern: new RegExp(`\\b${MONTH}\\s+(\\d{1,2})${ORD},?\\s+(\\d{4})\\b`, "gi"), read: (m) => [m[3], m[1], m[2]] },
  { pattern: new RegExp(`\\b${MONTH}\\s+(\\d{4})\\b`, "gi"), read: (m) => [m[2], m[1], undefined] },
  { pattern: new RegExp(`\\b(\\d{1,2})${ORD}\\s+${MONTH}(?![a-z])`, "gi"), read: (m) => [undefined, m[2], m[1]] },
  { pattern: new RegExp(`\\b${MONTH}\\s+(\\d{1,2})${ORD}\\b`, "gi"), read: (m) => [undefined, m[1], m[2]] },
];

const monthNumber = (month: string) => {
  const index = MONTHS.indexOf(month.slice(0, 3).toLowerCase());
  return index >= 0 ? String(index + 1) : String(Number(month));
};

/**
 * The values a text turns on: dates as "d:year-month-day" (parts may be
 * empty) and other numbers, without bare years or the given numbers.
 */
export function valuesIn(text: string, ignore: string[] = []): string[] {
  const values = new Set<string>();
  let rest = text;
  for (const { pattern, read } of DATES) {
    rest = rest.replace(pattern, (...args) => {
      const match = args.slice(0, -2) as unknown as RegExpExecArray;
      const [year, month, day] = read(match);
      values.add(`d:${year ?? ""}-${month ? monthNumber(month) : ""}-${day ? String(Number(day)) : ""}`);
      return " ";
    });
  }
  for (const n of numbersIn(rest)) if (!YEAR.test(n) && !ignore.includes(n)) values.add(n);
  return [...values];
}

/** Two values match if equal, or if they are dates whose known parts agree. */
function sameValue(a: string, b: string): boolean {
  if (a === b) return true;
  if (!a.startsWith("d:") || !b.startsWith("d:")) return false;
  const pa = a.slice(2).split("-");
  const pb = b.slice(2).split("-");
  return pa.every((part, i) => part === "" || pb[i] === "" || part === pb[i]);
}

const within = (a: string[], b: string[]) => a.every((x) => b.some((y) => sameValue(x, y)));

/** True when the two facts' values clash: neither fits inside the other. */
function clash(a: string[], b: string[]): boolean {
  return a.length > 0 && b.length > 0 && !within(a, b) && !within(b, a);
}

const factValues = (claim: FinalClaim) => valuesIn(claim.text, numbersIn(claim.topic));

const topicKey = (topic: string) => normalizeText(topic).replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

export function findConflicts(claims: FinalClaim[]): ConflictGroup[] {
  const byTopic = new Map<string, FinalClaim[]>();
  for (const claim of claims) {
    // Only new facts with a page behind them can disagree with each other.
    if (claim.status !== "supported" || claim.url === "" || claim.oldClaim !== null) continue;
    const key = topicKey(claim.topic);
    if (key === "" || factValues(claim).length === 0) continue;
    byTopic.set(key, [...(byTopic.get(key) ?? []), claim]);
  }

  const groups: ConflictGroup[] = [];
  for (const group of byTopic.values()) {
    // Facts from different sites whose values clash. One page listing a
    // monthly and an annual price is not a disagreement.
    const disagree = group.some((a) =>
      group.some((b) => siteName(a.url) !== siteName(b.url) && clash(factValues(a), factValues(b))),
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
 * when one of its own values (one no other side shares) is in the answer.
 */
export function checkConflictsShown(groups: ConflictGroup[], answer: string, evidence: Evidence[]): ClaimProblem[] {
  const shown = valuesIn(answer);
  const problems: ClaimProblem[] = [];
  for (const group of groups) {
    const sides = [...new Map(group.claims.map((c) => [factValues(c).sort().join("|"), c])).values()];
    const hidden = sides.filter((c) => {
      const others = sides.filter((o) => o !== c).flatMap(factValues);
      const own = factValues(c).filter((v) => !others.some((o) => sameValue(v, o)));
      return own.length > 0 && !own.some((v) => shown.some((s) => sameValue(v, s)));
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
