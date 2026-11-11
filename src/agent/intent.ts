// Picks the path for a message, in code, before any model call.
//
//   talk:     clear small talk ("thanks!") -> answer at once, no search
//   memory:   asks what was said before, not whether it still holds
//             ("what did I ask on 3 Nov?") -> answer from memory, no search
//   research: everything else -> search by default
//
// Search is the default on purpose: wrongly skipping a search gives a stale
// answer, while wrongly searching only costs a second or two.

const SMALL_TALK =
  /^\s*(thanks|thank you|thx|ty|cheers|great|awesome|cool|nice|perfect|ok|okay|got it|sounds good|hi|hello|hey|good (morning|afternoon|evening)|bye|goodbye|see you)\b[^?]{0,40}$/i;

/** Words that ask whether something still holds, or what it is now. */
const CHECK_NOW =
  /\b(still|changed?|changes|now|today|currently|current|latest|update[ds]?|since|correct|right|accurate|true|valid|cheaper|pricier|more expensive|price[ds]?|pricing|cost[s]?|shipped|released|launched|new)\b/i;

export function isSmallTalk(message: string): boolean {
  return message.trim().length <= 60 && SMALL_TALK.test(message);
}

export function asksAboutNow(message: string): boolean {
  return CHECK_NOW.test(message);
}

export type Path = "talk" | "memory" | "research";

export function choosePath(message: string, refersToPast: boolean): Path {
  if (isSmallTalk(message)) return "talk";
  if (refersToPast && !asksAboutNow(message)) return "memory";
  return "research";
}
