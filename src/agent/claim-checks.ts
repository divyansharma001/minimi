// Checks on claims that are plain text facts, so code does them, not the model.
//
// For an old claim, re-read today:
//   its quote is still on the page       -> "same"
//   the page is gone (404)               -> "cannot-confirm"
//   the page was read but the quote is gone -> "changed" (the model reads the new value)
//   its numbers never matched its own saved quote -> "was-wrong", whatever today says
//
// Quotes are compared after normalising, so Markdown marks, table pipes,
// spacing and curly quotes do not count as changes. Words and numbers do.

import type { ClaimStatus, StoredClaim } from "../memory/types.ts";
import type { Snapshot } from "../search/snapshots.ts";

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[*_`|>#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True if the quote appears on the page. Very short quotes never count. */
export function quoteOnPage(quote: string, page: string): boolean {
  const q = normalizeText(quote);
  return q.length >= 8 && normalizeText(page).includes(q);
}

/** The numbers in a text, without thousands commas: "$1,799.00" -> "1799.00". */
export function numbersIn(text: string): string[] {
  return [...new Set((text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, "")))];
}

/** True if every number in the claim also appears in its quote. */
export function numbersAgree(claimText: string, quote: string): boolean {
  const inQuote = new Set(numbersIn(quote));
  return numbersIn(claimText).every((n) => inQuote.has(n));
}

export type TodayCheck = "on-page" | "gone-from-page" | "page-gone" | "not-read";

export type OldClaimCheck = {
  /** "O1", "O2", ... as shown to the model. */
  ref: string;
  chatId: string;
  claim: StoredClaim;
  today: TodayCheck;
  /** False if the old claim never matched its own saved quote. */
  matchedOwnQuote: boolean;
  /** The status code decides on its own, or null if the model must decide. */
  status: ClaimStatus | null;
  snapshotId?: string;
};

export function checkOldClaims(
  old: { chatId: string; claim: StoredClaim }[],
  todayCopies: Map<string, Snapshot>,
): OldClaimCheck[] {
  return old.map(({ chatId, claim }, i) => {
    const copy = todayCopies.get(claim.url);
    const today: TodayCheck = !copy
      ? "not-read"
      : copy.status === 404 || copy.status === 410
        ? "page-gone"
        : copy.status >= 400
          ? "not-read"
          : quoteOnPage(claim.quote, copy.markdown)
            ? "on-page"
            : "gone-from-page";
    const matchedOwnQuote = numbersAgree(claim.text, claim.quote);
    const status: ClaimStatus | null = !matchedOwnQuote
      ? "was-wrong"
      : today === "on-page"
        ? "same"
        : today === "page-gone"
          ? "cannot-confirm"
          : today === "gone-from-page"
            ? "changed"
            : null;
    return {
      ref: `O${i + 1}`,
      chatId,
      claim,
      today,
      matchedOwnQuote,
      status,
      ...(copy ? { snapshotId: copy.id } : {}),
    };
  });
}
