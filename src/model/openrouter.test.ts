import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenRouterClient } from "./openrouter.ts";
import { ModelError } from "./types.ts";

function fakeRouter(responses: Response[]) {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const next = responses.shift();
    if (!next) throw new Error("no more fake responses");
    return next;
  }) as typeof fetch;
  return { bodies, fetchImpl };
}

const reply = (message: unknown, extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.0001 }, ...extra }),
    { status: 200 },
  );

test("sends the routing rules that protect cost, privacy and the JSON schema", async () => {
  const { bodies, fetchImpl } = fakeRouter([reply({ content: "{}" })]);
  await new OpenRouterClient("sk-or-x", "deepseek/deepseek-v4.1-flash", { fetchImpl }).complete({
    messages: [{ role: "user", content: "hi" }],
    jsonSchema: { name: "answer", schema: { type: "object" } },
    effort: "low",
  });
  const body = bodies[0] ?? {};
  assert.equal(body.model, "deepseek/deepseek-v4.1-flash");
  assert.deepEqual(body.provider, {
    require_parameters: true,
    data_collection: "deny",
    max_price: { prompt: 0.5, completion: 2 },
  });
  assert.deepEqual(body.response_format, {
    type: "json_schema",
    json_schema: { name: "answer", strict: true, schema: { type: "object" } },
  });
  assert.deepEqual(body.reasoning, { effort: "low", exclude: true });
  assert.equal(body.tools, undefined);
});

test("reads text, tool calls, usage and the provider", async () => {
  const { fetchImpl } = fakeRouter([
    reply(
      {
        content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "web_search", arguments: '{"queries":["x"]}' } }],
      },
      { provider: "DeepInfra" },
    ),
  ]);
  const result = await new OpenRouterClient("k", "m", { fetchImpl }).complete({ messages: [] });
  assert.equal(result.content, "");
  assert.deepEqual(result.toolCalls, [{ id: "c1", name: "web_search", arguments: '{"queries":["x"]}' }]);
  assert.deepEqual(result.usage, { inputTokens: 100, outputTokens: 20, cost: 0.0001 });
  assert.equal(result.provider, "DeepInfra");
});

test("a busy or failing provider is retried once", async () => {
  const { bodies, fetchImpl } = fakeRouter([new Response("{}", { status: 503 }), reply({ content: "ok" })]);
  const result = await new OpenRouterClient("k", "m", { fetchImpl }).complete({ messages: [] });
  assert.equal(result.content, "ok");
  assert.equal(bodies.length, 2);
});

test("errors become plain messages", async () => {
  for (const [status, reason, message] of [
    [401, "auth", /OPENROUTER_API_KEY was rejected/],
    [402, "credits", /out of credit/],
  ] as const) {
    const { fetchImpl } = fakeRouter([new Response("{}", { status })]);
    await assert.rejects(
      new OpenRouterClient("k", "m", { fetchImpl }).complete({ messages: [] }),
      (e: unknown) => e instanceof ModelError && e.reason === reason && message.test(e.message),
    );
  }
});

test("an empty reply is an error, not a blank answer", async () => {
  const empty = () => new Response(JSON.stringify({ choices: [] }), { status: 200 });
  const { fetchImpl } = fakeRouter([empty(), empty()]);
  await assert.rejects(new OpenRouterClient("k", "m", { fetchImpl }).complete({ messages: [] }), /empty reply/);
});

test("a provider that fails mid-reply (200 with an error) is retried once", async () => {
  const failed = new Response(JSON.stringify({ error: { code: 502, message: "Provider disconnected" } }), { status: 200 });
  const { bodies, fetchImpl } = fakeRouter([failed, reply({ content: "ok" })]);
  const result = await new OpenRouterClient("k", "m", { fetchImpl }).complete({ messages: [] });
  assert.equal(result.content, "ok");
  assert.equal(bodies.length, 2);

  const inChoice = () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "partial" }, finish_reason: "error" }] }), { status: 200 });
  const twice = fakeRouter([inChoice(), inChoice()]);
  await assert.rejects(
    new OpenRouterClient("k", "m", { fetchImpl: twice.fetchImpl }).complete({ messages: [] }),
    (e: unknown) => e instanceof ModelError && e.reason === "provider",
  );
});

test("a reply cut off by the token cap says so", async () => {
  const { fetchImpl } = fakeRouter([reply({ content: '{"answer": "Neon' }, { choices: [{ message: { content: '{"answer": "Neon' }, finish_reason: "length" }] })]);
  const result = await new OpenRouterClient("k", "m", { fetchImpl }).complete({ messages: [] });
  assert.equal(result.finishReason, "length");
});
