// The fake web as a search provider and a page reader, for tests.
//
// It answers like the real thing, using the version of each page that was
// live on the test's "today". Search is keyword search over page text, so
// queries must be reasonable to find the right page, as with a real engine.

import { KeywordIndex, terms } from "../text/keywords.ts";
import type { IsoDate } from "../memory/types.ts";
import type { PageFetcher, RawPage, SearchBackend, SearchHit, SearchOptions } from "../search/types.ts";
import type { FixturePage } from "./types.ts";
import { pageOn } from "./fixtures/web.ts";

export class FixtureWeb implements SearchBackend, PageFetcher {
  private readonly pages: FixturePage[];
  private readonly day: IsoDate;
  /** Every query searched and URL read, in order, for tests to inspect. */
  readonly searched: string[] = [];
  readonly fetched: string[] = [];

  constructor(pages: FixturePage[], day: IsoDate) {
    this.pages = pages;
    this.day = day;
  }

  async search(query: string, options: SearchOptions): Promise<SearchHit[]> {
    this.searched.push(query);
    const live = this.pages.flatMap((page) => {
      const version = pageOn(page, this.day);
      if (!version || version.status !== 200) return [];
      if (options.site && !new URL(page.url).hostname.endsWith(options.site)) return [];
      if (options.topic === "news") {
        if (!version.publishedOn) return [];
        if (options.since && version.publishedOn < options.since) return [];
      }
      return [{ page, version }];
    });
    const index = new KeywordIndex(live.map(({ page, version }) => ({ id: page.url, text: `${version.title}\n${version.markdown}` })));
    const byUrl = new Map(live.map((l) => [l.page.url, l.version]));
    return index
      .search(terms(query))
      .slice(0, options.maxResults)
      .map((hit) => {
        const version = byUrl.get(hit.id);
        return {
          url: hit.id,
          title: version?.title ?? hit.id,
          snippet: (version?.markdown ?? "").replace(/^#.*$/m, "").trim().slice(0, 200),
          ...(version?.publishedOn ? { publishedOn: version.publishedOn } : {}),
        };
      });
  }

  async fetch(url: string): Promise<RawPage> {
    this.fetched.push(url);
    const page = this.pages.find((p) => p.url === url);
    const version = page ? pageOn(page, this.day) : null;
    if (!version) {
      return { url, finalUrl: url, status: 404, contentType: "text/markdown", body: "# 404\n\nNot found." };
    }
    return { url, finalUrl: url, status: version.status, contentType: "text/markdown", body: version.markdown };
  }
}
