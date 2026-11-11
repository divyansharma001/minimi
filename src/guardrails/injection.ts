// Removes text in web pages that is written to an AI rather than to people.
//
// Hidden text is already removed by the cleaner. This catches the visible
// kind: "Note to AI assistants: ignore previous instructions and ...". Such a
// paragraph is cut from the page before the model sees it, and the cut is
// reported. Only the offending paragraph or table row goes, so the facts
// around it (a price on the line above) survive.
//
// The patterns are narrow on purpose. A page saying "System requirements:
// macOS 14" or "Assistant manager" must not lose a line.

const PATTERNS: RegExp[] = [
  /\bignore\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier|preceding)\s+(?:instructions|prompts|messages|rules|directions)\b/i,
  /\b(?:disregard|forget|override)\s+(?:all\s+|any\s+|your\s+|the\s+)?(?:previous\s+|prior\s+|earlier\s+)?(?:instructions|rules|guidelines|system prompt)\b/i,
  /\b(?:note|message|instructions?|attention)\s+(?:to|for)\s+(?:the\s+|any\s+|all\s+)?(?:ai|llm|assistant|language model|chatbot|agent)s?\b/i,
  /\b(?:system|developer)\s+(?:prompt|message|instruction)s?\s*:/i,
  /^\s*\[?(?:system|assistant)\]?\s*:\s*(?:ignore|you|always|never|do not|don't|from now on)\b/im,
  /<\/?\s*(?:system|instructions?|prompt)\s*>/i,
  /\b(?:reveal|print|output|repeat)\s+(?:your\s+)?(?:system prompt|hidden instructions|initial instructions)\b/i,
  /\byou are now\s+(?:an?\s+)?(?:ai|assistant|chatbot|language model|llm|dan)\b/i,
];

export function looksLikeInjection(text: string): boolean {
  return PATTERNS.some((p) => p.test(text));
}

/**
 * Cuts paragraphs (and single table rows) that look like instructions to an
 * AI. Returns the cleaned page and what was cut.
 */
export function stripInjections(markdown: string): { markdown: string; removed: string[] } {
  const removed: string[] = [];
  const blocks = markdown.split(/\n{2,}/).flatMap((block) => {
    const isTable = block.split("\n").every((line) => line.trimStart().startsWith("|"));
    if (isTable) {
      const rows = block.split("\n").filter((row) => {
        if (!looksLikeInjection(row)) return true;
        removed.push(row.trim());
        return false;
      });
      return rows.length > 0 ? [rows.join("\n")] : [];
    }
    if (!looksLikeInjection(block)) return [block];
    removed.push(block.trim());
    return [];
  });
  return { markdown: blocks.join("\n\n"), removed };
}
