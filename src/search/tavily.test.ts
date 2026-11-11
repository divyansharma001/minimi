import { test } from "node:test";
import assert from "node:assert/strict";
import { TavilyBackend } from "./tavily.ts";
import { SearchError } from "./types.ts";

type Call = { url: string; body: Record<string, unknown>; auth: string };

function fakeTavily(responses: Response[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      auth: new Headers(init?.headers).get("authorization") ?? "",
    });
    const next = responses.shift();
    if (!next) throw new Error("no more fake responses");
    return next;
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const ok = (results: unknown[]) => new Response(JSON.stringify({ results }), { status: 200 });

test("sends a basic search and maps the results", async () => {
  const { calls, fetchImpl } = fakeTavily([
    ok([
      { url: "https://neon.com/pricing", title: "Neon pricing", content: "Launch $19", published_date: "Mon, 09 Nov 2026 10:00:00 GMT" },
      { title: "no url, so skipped" },
    ]),
  ]);
  const hits = await new TavilyBackend("tvly-key", { fetchImpl }).search("neon pricing", {
    topic: "general",
    maxResults: 5,
  });
  assert.deepEqual(hits, [
    { url: "https://neon.com/pricing", title: "Neon pricing", snippet: "Launch $19", publishedOn: "2026-11-09" },
  ]);
  assert.equal(calls[0]?.url, "https://api.tavily.com/search");
  assert.equal(calls[0]?.auth, "Bearer tvly-key");
  assert.equal(calls[0]?.body.search_depth, "basic", "basic costs 1 credit, advanced costs 2");
  assert.equal(calls[0]?.body.max_results, 5);
});

test("a site limit and a news start date are passed on", async () => {
  const { calls, fetchImpl } = fakeTavily([ok([]), ok([])]);
  const tavily = new TavilyBackend("k", { fetchImpl });
  await tavily.search("dealcraft launch", { topic: "news", since: "2026-11-09", site: "dealcraft.com", maxResults: 3 });
  assert.deepEqual(calls[0]?.body.include_domains, ["dealcraft.com"]);
  assert.equal(calls[0]?.body.start_date, "2026-11-09");
  // A general search ignores the start date: pricing pages rarely have one.
  await tavily.search("dealcraft pricing", { topic: "general", since: "2026-11-09", maxResults: 3 });
  assert.equal(calls[1]?.body.start_date, undefined);
});

test("errors become plain messages", async () => {
  const cases: [number, string, RegExp][] = [
    [401, "auth", /TAVILY_API_KEY was rejected/],
    [432, "quota", /used up/],
    [500, "provider", /failed \(500\)/],
  ];
  for (const [status, reason, message] of cases) {
    const { fetchImpl } = fakeTavily([new Response("oops", { status })]);
    await assert.rejects(
      new TavilyBackend("k", { fetchImpl }).search("x", { topic: "general", maxResults: 1 }),
      (error: unknown) => error instanceof SearchError && error.reason === reason && message.test(error.message),
    );
  }
});

test("a short rate limit is retried once; a long one is not waited on", async () => {
  const short = fakeTavily([new Response("", { status: 429, headers: { "retry-after": "0" } }), ok([])]);
  await new TavilyBackend("k", { fetchImpl: short.fetchImpl }).search("x", { topic: "general", maxResults: 1 });
  assert.equal(short.calls.length, 2);

  const long = fakeTavily([new Response("", { status: 429, headers: { "retry-after": "60" } })]);
  await assert.rejects(
    new TavilyBackend("k", { fetchImpl: long.fetchImpl }).search("x", { topic: "general", maxResults: 1 }),
    /limiting requests/,
  );
  assert.equal(long.calls.length, 1);
});
