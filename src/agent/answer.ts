// Reads the writer's JSON and turns it into the final claims.
//
// The schema is enforced by the provider, but "strict" is a strong hint on
// some providers, not a guarantee. So the reply is checked again here, and
// anything unusable is dropped with a note rather than trusted.

import type { ClaimStatus } from "../memory/types.ts";
import type { Evidence } from "../search/tool.ts";
import type { OldClaimCheck } from "./claim-checks.ts";

export type FinalClaim = {
  text: string;
  /** What the fact is about, named by the writer. Facts on one topic can disagree. */
  topic: string;
  quote: string;
  url: string;
  status: ClaimStatus;
  /** 1-based evidence number, or null. */
  source: number | null;
  oldClaim: string | null;
  /** The day the source page was read. */
  readOn: string;
  /** The conflict group this fact belongs to, set by code; null if none. */
  conflict: number | null;
};

export type ParsedAnswer = { answer: string; claims: FinalClaim[]; problems: string[] };

const STATUSES = new Set<ClaimStatus>(["supported", "same", "changed", "was-wrong", "cannot-confirm"]);

type RawClaim = { text?: unknown; topic?: unknown; source?: unknown; quote?: unknown; status?: unknown; oldClaim?: unknown };

export function parseAnswer(
  content: string,
  evidence: Evidence[],
  oldChecks: OldClaimCheck[],
  today: string,
): ParsedAnswer | null {
  let data: { answer?: unknown; claims?: unknown };
  try {
    // Some providers wrap JSON in a code fence despite the schema.
    data = JSON.parse(content.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")) as typeof data;
  } catch {
    return null;
  }
  if (typeof data.answer !== "string" || data.answer.trim() === "") return null;

  const problems: string[] = [];
  const oldByRef = new Map(oldChecks.map((c) => [c.ref, c]));
  const claims: FinalClaim[] = [];

  for (const raw of Array.isArray(data.claims) ? (data.claims as RawClaim[]) : []) {
    if (typeof raw.text !== "string" || !STATUSES.has(raw.status as ClaimStatus)) {
      problems.push("Dropped a claim with a missing text or status.");
      continue;
    }
    const source = typeof raw.source === "number" && Number.isInteger(raw.source) ? raw.source : null;
    const item = source !== null ? evidence[source - 1] : undefined;
    if (source !== null && !item) {
      problems.push(`Dropped "${raw.text}": it cites [${source}], which does not exist.`);
      continue;
    }
    const old = typeof raw.oldClaim === "string" ? oldByRef.get(raw.oldClaim) : undefined;
    if (old && item && item.url !== old.claim.url) {
      problems.push(`"${raw.text}" reports on ${old.ref} (${old.claim.url}) but cites a different page, [${source}].`);
    }
    // The app's own status for an old claim wins over the model's.
    let status = old?.status ?? (raw.status as ClaimStatus);
    // "same", "changed" and "was-wrong" compare against an old claim; without
    // one they mean nothing. A sourced fact is then just "supported".
    if (!old && (status === "same" || status === "changed" || status === "was-wrong")) {
      if (item) {
        status = "supported";
      } else {
        problems.push(`Dropped "${raw.text}": marked ${status}, but it names no old claim and no source.`);
        continue;
      }
    }
    claims.push({
      text: raw.text,
      topic: typeof raw.topic === "string" ? raw.topic.trim() : "",
      quote: typeof raw.quote === "string" ? raw.quote : "",
      // A report on an old claim is about that claim's own page.
      url: old?.claim.url ?? item?.url ?? "",
      status,
      source,
      oldClaim: old ? old.ref : null,
      readOn: item?.readOn ?? today,
      conflict: null,
    });
  }
  return { answer: data.answer.trim(), claims, problems };
}
