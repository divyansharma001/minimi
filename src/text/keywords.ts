// Keyword search, shared by memory recall and by web passage ranking.
//
// BM25 scoring: a match on a rare word ("Postgres") counts for more than a
// match on a common one ("pricing"), and long texts do not win just by being
// long. Words are cut to a rough stem, so "hosting" matches "host" and
// "pricing" matches "price". Small and plain on purpose: no dependency, and
// every rule can be read and tested.

// Words that carry no topic. Conversational words ("asked", "remember",
// "correct") are here too, because in "what did I ask you about Postgres" only
// "Postgres" says what the chat was about. Date words are here because dates
// are handled by the date resolver.
const STOP_WORDS = new Set(
  `a an the and or but if then than so to of in on at by for with from about as into over after before
  since until while is are was were be been being am do does did done doing have has had having
  i me my mine we us our ours you your yours he she it its they them their this that these those there here
  what which who whom whose when where why how any some all each every much many more most few no not nor
  only own same such too very can could should would will shall may might must just also still again ever never
  now ok okay yes yeah hi hello hey thanks thank please got get gets getting going go
  ask asked asking tell told telling say said saying remember recall talk talked talking discuss discussed
  mention mentioned answer answered answers reply replied correct right wrong true false change changed changes
  something anything everything thing things one ones lot lots
  today tomorrow yesterday tonight morning afternoon evening ago last next week weeks day days month months
  year years earlier later previous previously time
  monday tuesday wednesday thursday friday saturday sunday
  january february march april june july august september october november december
  jan feb mar apr jun jul aug sep sept oct nov dec st nd rd th`.split(/\s+/),
);

/** A rough English stem: enough to match plural and -ing/-ed forms. */
export function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 4 && /(s|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  if (w.length > 4 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

export type Term = { stem: string; word: string };

/** The topic words in a text, lower-cased and stemmed, in order, with repeats. */
export function terms(text: string): Term[] {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return words
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
    .map((word) => ({ stem: stem(word), word }));
}

export type Hit = { id: string; score: number; matched: string[] };

/** Searches a fixed set of texts. Build once, search many times. */
export class KeywordIndex {
  private readonly docs: { id: string; counts: Map<string, number>; length: number }[];
  private readonly docFrequency = new Map<string, number>();
  private readonly averageLength: number;

  constructor(documents: { id: string; text: string }[]) {
    this.docs = documents.map(({ id, text }) => {
      const counts = new Map<string, number>();
      const found = terms(text);
      for (const t of found) counts.set(t.stem, (counts.get(t.stem) ?? 0) + 1);
      return { id, counts, length: found.length };
    });
    for (const doc of this.docs) {
      for (const s of doc.counts.keys()) this.docFrequency.set(s, (this.docFrequency.get(s) ?? 0) + 1);
    }
    const total = this.docs.reduce((sum, d) => sum + d.length, 0);
    this.averageLength = this.docs.length > 0 ? total / this.docs.length : 0;
  }

  /**
   * Scores each document that matches at least one query word, best first.
   * `matched` lists the query's own words (not stems) that the document had.
   */
  search(query: Term[], options: { only?: Set<string> } = {}): Hit[] {
    const k1 = 1.2;
    const b = 0.75;
    const n = this.docs.length;
    const unique = [...new Map(query.map((t) => [t.stem, t])).values()];
    const hits: Hit[] = [];

    for (const doc of this.docs) {
      if (options.only && !options.only.has(doc.id)) continue;
      let score = 0;
      const matched: string[] = [];
      for (const term of unique) {
        const count = doc.counts.get(term.stem) ?? 0;
        if (count === 0) continue;
        const df = this.docFrequency.get(term.stem) ?? 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        const lengthRatio = this.averageLength > 0 ? doc.length / this.averageLength : 1;
        score += (idf * count * (k1 + 1)) / (count + k1 * (1 - b + b * lengthRatio));
        matched.push(term.word);
      }
      if (matched.length > 0) hits.push({ id: doc.id, score, matched });
    }
    return hits.sort((x, y) => y.score - x.score);
  }
}
