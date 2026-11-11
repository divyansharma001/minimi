import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MODEL, readConfig } from "./env.ts";

const keys = { OPENROUTER_API_KEY: "sk-or-test", TAVILY_API_KEY: "tvly-test" };

test("missing keys give one clear problem each, not a crash", () => {
  const result = readConfig({});
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.problems.length, 2);
    assert.match(result.problems[0] ?? "", /OPENROUTER_API_KEY is missing/);
    assert.match(result.problems[1] ?? "", /TAVILY_API_KEY is missing/);
  }
});

test("each key is checked on its own", () => {
  const result = readConfig({ OPENROUTER_API_KEY: "sk-or-test" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.problems.length, 1);
});

test("a key made only of spaces counts as missing", () => {
  const result = readConfig({ ...keys, OPENROUTER_API_KEY: "   " });
  assert.equal(result.ok, false);
});

test("the model falls back to the default when MODEL is not set", () => {
  const result = readConfig(keys);
  assert.deepEqual(result, {
    ok: true,
    config: {
      openRouterApiKey: "sk-or-test",
      tavilyApiKey: "tvly-test",
      model: DEFAULT_MODEL,
      guardModel: "meta-llama/llama-guard-4-12b",
      dailySearches: 50,
      dailyModelUsd: 0.5,
    },
  });
});

test("MODEL overrides the default", () => {
  const result = readConfig({ ...keys, MODEL: "openai/gpt-6-luna" });
  assert.equal(result.ok && result.config.model, "openai/gpt-6-luna");
});

test("daily caps can be set, and a bad value is a clear problem", () => {
  const set = readConfig({ ...keys, DAILY_SEARCH_LIMIT: "200", DAILY_MODEL_SPEND_USD: "2.5" });
  assert.equal(set.ok && set.config.dailySearches, 200);
  assert.equal(set.ok && set.config.dailyModelUsd, 2.5);
  const bad = readConfig({ ...keys, DAILY_SEARCH_LIMIT: "lots" });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.problems[0] ?? "", /DAILY_SEARCH_LIMIT must be a number/);
});
