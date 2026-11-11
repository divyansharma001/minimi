// Finds pages through Tavily's search API (https://docs.tavily.com).
//
// Tavily only finds pages here. It can also return page text, but we read
// pages ourselves: "has the price changed?" compares an old copy with today's,
// and both must come from the same cleaner, or small differences in how two
// tools extract text would look like changes.
//
// Always "basic" depth (1 credit). "advanced" and auto settings cost 2.

import { SearchError, type SearchBackend, type SearchHit, type SearchOptions } from "./types.ts";

const ENDPOINT = "https://api.tavily.com/search";

type TavilyResult = { url?: unknown; title?: unknown; content?: unknown; published_date?: unknown };

export type TavilyOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Waits for a 429 retry are capped here, so a chat never hangs on one. */
  maxRetryWaitMs?: number;
};

const dayOf = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString().slice(0, 10);
};

export class TavilyBackend implements SearchBackend {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetryWaitMs: number;

  constructor(apiKey: string, options: TavilyOptions = {}) {
    this.apiKey = apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetryWaitMs = options.maxRetryWaitMs ?? 5_000;
  }

  async search(query: string, options: SearchOptions): Promise<SearchHit[]> {
    const body = {
      query,
      search_depth: "basic",
      topic: options.topic,
      max_results: options.maxResults,
      include_published_date: true,
      ...(options.site ? { include_domains: [options.site] } : {}),
      // A start date filters by publish date. Pricing pages rarely have one,
      // so only news searches use it.
      ...(options.topic === "news" && options.since ? { start_date: options.since } : {}),
    };

    let response = await this.post(body);
    if (response.status === 429) {
      const wait = Number(response.headers.get("retry-after") ?? "1") * 1000;
      if (wait > this.maxRetryWaitMs) {
        throw new SearchError("rate-limit", "Tavily is limiting requests right now. Try again in a minute.");
      }
      await new Promise((resolve) => setTimeout(resolve, wait));
      response = await this.post(body);
    }
    if (!response.ok) throw await this.errorFor(response);

    const data = (await response.json()) as { results?: TavilyResult[] };
    return (data.results ?? []).flatMap((r): SearchHit[] => {
      if (typeof r.url !== "string") return [];
      const publishedOn = dayOf(r.published_date);
      return [
        {
          url: r.url,
          title: typeof r.title === "string" ? r.title : r.url,
          snippet: typeof r.content === "string" ? r.content : "",
          ...(publishedOn ? { publishedOn } : {}),
        },
      ];
    });
  }

  private post(body: unknown): Promise<Response> {
    return this.fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  private async errorFor(response: Response): Promise<SearchError> {
    switch (response.status) {
      case 401:
        return new SearchError("auth", "TAVILY_API_KEY was rejected. Check the key in .env.");
      case 429:
        return new SearchError("rate-limit", "Tavily is limiting requests right now. Try again in a minute.");
      case 432:
      case 433:
        return new SearchError("quota", "Tavily's searches for this month are used up, so web search is off until they reset.");
      default: {
        const detail = (await response.text().catch(() => "")).slice(0, 200);
        return new SearchError("provider", `Tavily search failed (${response.status}). ${detail}`.trim());
      }
    }
  }
}
