// Checks each user message with a safety model before the agent acts on it.
//
// Llama Guard 4 answers "safe", or "unsafe" plus hazard codes (S1..S14).
// It takes 1 to 2 seconds, so the turn starts it first and only waits for it
// before touching the web or showing an answer: the check costs no time.
//
// Policy, by code:
//   refuse:  weapons, violent and other crimes, child abuse, hate, sexual content
//   support: suicide and self-harm get a caring reply with where to find help
//   allow:   medical/legal/financial questions, privacy, IP, elections, defamation.
//            These are often normal questions ("what does Ozempic cost?"), and
//            blocking them would make the agent worse. The main model handles them.
//
// If the safety model fails, the turn goes on and a problem is noted: the main
// model has its own safety, and one provider's outage should not stop the agent.

import type { ModelClient } from "../model/types.ts";

export const HAZARDS: Record<string, string> = {
  S1: "violent crimes",
  S2: "non-violent crimes",
  S3: "sex-related crimes",
  S4: "child sexual exploitation",
  S5: "defamation",
  S6: "specialised advice",
  S7: "privacy",
  S8: "intellectual property",
  S9: "indiscriminate weapons",
  S10: "hate",
  S11: "suicide and self-harm",
  S12: "sexual content",
  S13: "elections",
  S14: "code interpreter abuse",
};

const REFUSE = new Set(["S1", "S2", "S3", "S4", "S9", "S10", "S12"]);
const SUPPORT = new Set(["S11"]);

export type SafetyVerdict =
  | { action: "allow"; categories: string[] }
  | { action: "refuse" | "support"; categories: string[] }
  | { action: "unchecked"; reason: string };

export const REFUSAL =
  "I can't help with that. If you have a different question, or want to look something up, I'm happy to help.";

export const SUPPORT_REPLY = [
  "I'm really sorry you're feeling this way. You don't have to go through it alone.",
  "",
  "If you might act on these thoughts, please contact your local emergency number now.",
  "If you're in the US, you can call or text 988 to reach the Suicide & Crisis Lifeline, any time.",
  "Elsewhere, findahelpline.com lists free, confidential lines in your country.",
  "",
  "If you'd like, tell me a bit about what's going on. I'm here to listen.",
].join("\n");

/** Reads Llama Guard's reply: "safe", or "unsafe" then codes like "S9,S11". */
export function parseGuardReply(content: string): { unsafe: boolean; categories: string[] } | null {
  const lines = content.trim().split("\n").map((l) => l.trim());
  if (lines[0] === "safe") return { unsafe: false, categories: [] };
  if (lines[0] !== "unsafe") return null;
  const categories = (lines[1] ?? "").split(",").map((c) => c.trim()).filter((c) => /^S\d{1,2}$/.test(c));
  return { unsafe: true, categories };
}

export function decide(categories: string[]): SafetyVerdict {
  if (categories.some((c) => SUPPORT.has(c))) return { action: "support", categories };
  if (categories.some((c) => REFUSE.has(c))) return { action: "refuse", categories };
  return { action: "allow", categories };
}

export async function checkInput(guard: ModelClient | undefined, message: string, timeoutMs = 6_000): Promise<SafetyVerdict> {
  if (!guard) return { action: "unchecked", reason: "no safety model configured" };
  const timeout = new Promise<SafetyVerdict>((resolve) =>
    setTimeout(() => resolve({ action: "unchecked", reason: "the safety check timed out" }), timeoutMs),
  );
  const check = guard
    .complete({ messages: [{ role: "user", content: message }], maxTokens: 20 })
    .then((reply): SafetyVerdict => {
      const parsed = parseGuardReply(reply.content);
      if (!parsed) return { action: "unchecked", reason: "the safety check gave an unreadable answer" };
      return parsed.unsafe ? decide(parsed.categories) : { action: "allow", categories: [] };
    })
    .catch((): SafetyVerdict => ({ action: "unchecked", reason: "the safety check failed" }));
  return Promise.race([check, timeout]);
}
