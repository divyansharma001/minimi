// Checks each claim in a written answer against the saved pages, in code.
//
//   - Its quote must be on its page: the full saved copy, not only the
//     passage the model saw. Marks, spacing and curly quotes do not count.
//   - Every number in the claim must be in its quote. Dates the app knows
//     (today, the old chat's day, the page's own date, the day it was read)
//     may appear too: "as of 11 Nov 2026" needs no quote.
//   - When an official page in the evidence also carries the quote, the claim
//     should cite it rather than a third-party copy.
//
// A failed quote or number check is "hard": the claim is repaired or dropped.
// A third-party citation is "soft": the writer is asked to switch, but the
// claim stays if it cannot, since a copy is still evidence.

import type { Evidence } from "../search/tool.ts";
import type { FinalClaim } from "./answer.ts";
import { normalizeText, numbersIn, quoteOnPage, type OldClaimCheck } from "./claim-checks.ts";

export type ClaimProblem = {
  claim: FinalClaim;
  kind: "hard" | "soft";
  /** Plain words, shown to the writer in a repair round. */
  reason: string;
  /** True when one more search may settle it, even though it is soft. */
  research?: boolean;
};

/** The full text of the page an evidence item came from. */
export type PageText = (item: Evidence) => string;

/** "neon" for neon.com, docs.neon.tech and www.neon.com. */
export function siteName(url: string): string {
  const labels = new URL(url).hostname.replace(/^www\./, "").split(".");
  return labels.length >= 2 ? (labels[labels.length - 2] ?? "") : (labels[0] ?? "");
}

/** Numbers of the dates the app itself knows, which a claim may mention freely. */
function knownDateNumbers(days: string[]): Set<string> {
  const numbers = new Set<string>();
  for (const day of days) {
    const [year, , date] = day.split("-");
    if (year) numbers.add(year);
    if (date) numbers.add(String(Number(date)));
  }
  return numbers;
}

export function checkClaims(
  claims: FinalClaim[],
  evidence: Evidence[],
  oldChecks: OldClaimCheck[],
  pageText: PageText,
  today: string,
): ClaimProblem[] {
  const oldByRef = new Map(oldChecks.map((c) => [c.ref, c]));
  const problems: ClaimProblem[] = [];

  for (const claim of claims) {
    // Nothing is asserted, or code already settled it from saved quotes.
    if (claim.status === "cannot-confirm") continue;
    const old = claim.oldClaim ? oldByRef.get(claim.oldClaim) : undefined;
    if (old && (claim.status === "same" || claim.status === "was-wrong")) continue;

    const item = claim.source !== null ? evidence[claim.source - 1] : undefined;
    if (!item) {
      problems.push({ claim, kind: "hard", reason: "it cites no evidence" });
      continue;
    }
    if (claim.quote.trim() === "") {
      problems.push({ claim, kind: "hard", reason: `it cites [${claim.source}] but gives no quote` });
      continue;
    }
    const page = pageText(item);
    if (!quoteOnPage(claim.quote, page)) {
      problems.push({ claim, kind: "hard", reason: `its quote is not on the page it cites, [${claim.source}]` });
      continue;
    }

    const allowed = new Set([
      ...numbersIn(claim.quote),
      // A changed claim names the old value too, which is in the old quote.
      ...(old ? numbersIn(old.claim.quote) : []),
      ...knownDateNumbers([today, item.readOn, ...(item.pageDate ? [item.pageDate.day] : []), ...(old ? [old.claim.capturedOn] : [])]),
    ]);
    const unsupported = numbersIn(claim.text).filter((n) => !allowed.has(n));
    if (unsupported.length > 0) {
      problems.push({ claim, kind: "hard", reason: `${unsupported.join(", ")} is not in its quote` });
      continue;
    }

    // Official source first: if the claim names a company, and that company's
    // own page in the evidence also has the quote, cite that page instead.
    const text = normalizeText(claim.text);
    const citedSite = siteName(item.url);
    if (!text.includes(citedSite)) {
      const official = evidence.findIndex(
        (e) => e.url !== item.url && text.includes(siteName(e.url)) && quoteOnPage(claim.quote, pageText(e)),
      );
      if (official >= 0) {
        problems.push({
          claim,
          kind: "soft",
          reason: `[${official + 1}] is the official page and says the same thing; cite it instead of [${claim.source}]`,
        });
      }
    }
  }
  return problems;
}
