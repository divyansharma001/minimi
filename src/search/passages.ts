// Cuts a page into passages and picks the ones that answer the question.
//
// The model sees a few short passages, not whole pages: it is faster, cheaper,
// and the model has less room to wander. Each passage keeps the heading it
// sits under, and a table is split by rows with its header row repeated, so a
// row like "| Pro | $79 |" never loses the "| Plan | Price |" that explains it.

import { KeywordIndex, terms } from "../text/keywords.ts";

export type Passage = { heading: string; text: string };

const isTableLine = (line: string) => line.trimStart().startsWith("|");
const isSeparator = (line: string) => /^\s*\|?\s*:?-{3,}/.test(line);

/** Splits Markdown into passages of at most about maxChars characters. */
export function splitPassages(markdown: string, maxChars = 700): Passage[] {
  const passages: Passage[] = [];
  let heading = "";
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join("\n\n").trim();
    if (text) passages.push({ heading, text });
    buffer = [];
  };
  const add = (block: string) => {
    const size = buffer.join("\n\n").length;
    if (size > 0 && size + block.length + 2 > maxChars) flush();
    buffer.push(block);
  };

  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      flush();
      heading = (headingMatch[2] ?? "").trim();
      continue;
    }
    if (isTableLine(line)) {
      const table: string[] = [];
      while (i < lines.length && isTableLine(lines[i] ?? "")) table.push(lines[i++] ?? "");
      i -= 1;
      flush();
      for (const chunk of splitTable(table, maxChars)) passages.push({ heading, text: chunk });
      continue;
    }
    if (line.trim() === "") continue;
    // A paragraph: lines until the next blank line, heading or table.
    const paragraph: string[] = [line];
    while (i + 1 < lines.length) {
      const next = lines[i + 1] ?? "";
      if (next.trim() === "" || /^#{1,6}\s/.test(next) || isTableLine(next)) break;
      paragraph.push(next);
      i += 1;
    }
    for (const piece of splitLong(paragraph.join("\n"), maxChars)) add(piece);
  }
  flush();
  return passages;
}

function splitTable(rows: string[], maxChars: number): string[] {
  const hasHeader = rows.length > 1 && isSeparator(rows[1] ?? "");
  const header = hasHeader ? rows.slice(0, 2) : [];
  const body = hasHeader ? rows.slice(2) : rows;
  const chunks: string[] = [];
  let current: string[] = [];
  const size = () => [...header, ...current].join("\n").length;
  for (const row of body) {
    if (current.length > 0 && size() + row.length + 1 > maxChars) {
      chunks.push([...header, ...current].join("\n"));
      current = [];
    }
    current.push(row);
  }
  if (current.length > 0 || header.length > 0) chunks.push([...header, ...current].join("\n"));
  return chunks;
}

/** Splits a long paragraph at sentence ends, then at spaces if it must. */
function splitLong(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const sentences = text.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) ?? [text];
  const pieces: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > maxChars) {
      pieces.push(current.trim());
      current = "";
    }
    current += sentence;
    while (current.length > maxChars) {
      const cut = current.lastIndexOf(" ", maxChars) > maxChars / 2 ? current.lastIndexOf(" ", maxChars) : maxChars;
      pieces.push(current.slice(0, cut).trim());
      current = current.slice(cut);
    }
  }
  if (current.trim()) pieces.push(current.trim());
  return pieces;
}

export type PageForRanking = { url: string; title: string; passages: Passage[]; mustInclude: boolean };
export type RankedPassage = {
  url: string;
  passage: Passage;
  score: number;
  /** The page's site name is in the question: likely the company's own site. */
  official: boolean;
};

/**
 * Picks the best passages across pages for a question.
 * - At most `perPage` from one page, so one long page cannot crowd out the rest.
 * - A page the user or agent asked to open by name always gets at least one
 *   passage, even if no word matches. With no query at all, it shows its
 *   first passages in page order.
 * - Each passage is scored with its page title too: pricing pages say
 *   "pricing" in the title, not in every table cell.
 * - A page whose site name is in the question ("basalt pricing" and
 *   basalt.example) gets a boost: the official source first.
 */
export function rankPassages(
  question: string,
  pages: PageForRanking[],
  options: { total?: number; perPage?: number } = {},
): RankedPassage[] {
  const total = options.total ?? 10;
  const perPage = options.perPage ?? 3;
  const query = terms(question);
  const queryStems = new Set(query.map((t) => t.stem));

  const all = pages.flatMap((page) =>
    page.passages.map((passage, i) => ({ id: `${page.url}#${i}`, page, passage })),
  );
  const index = new KeywordIndex(all.map((a) => ({ id: a.id, text: `${a.page.title}\n${a.passage.heading}\n${a.passage.text}` })));
  const scores = new Map(index.search(query).map((h) => [h.id, h.score]));

  const isOfficial = (url: string) => terms(new URL(url).hostname.split(".").join(" ")).some((t) => queryStems.has(t.stem));
  const ranked = all
    .map((a) => {
      const official = isOfficial(a.page.url);
      return { ...a, official, score: (scores.get(a.id) ?? 0) * (official ? 1.5 : 1) };
    })
    .sort((x, y) => y.score - x.score);

  const chosen: RankedPassage[] = [];
  const perPageCount = new Map<string, number>();
  const take = (item: (typeof all)[number] & { score: number }) => {
    chosen.push({ url: item.page.url, passage: item.passage, score: item.score, official: isOfficial(item.page.url) });
    perPageCount.set(item.page.url, (perPageCount.get(item.page.url) ?? 0) + 1);
  };

  for (const page of pages.filter((p) => p.mustInclude)) {
    const own = ranked.filter((r) => r.page === page);
    const best = own[0];
    if (!best) continue;
    if (best.score > 0) {
      take(best);
    } else {
      // No word to rank by (a page opened by name with no query): show the
      // page as written, in its own order, rather than an arbitrary passage.
      const inOrder = all.filter((a) => a.page === page).slice(0, perPage);
      for (const item of inOrder) take({ ...item, score: 0 });
    }
  }
  for (const item of ranked) {
    if (chosen.length >= total) break;
    if (item.score <= 0 || chosen.some((c) => c.passage === item.passage)) continue;
    if ((perPageCount.get(item.page.url) ?? 0) >= perPage) continue;
    take(item);
  }
  return chosen;
}
