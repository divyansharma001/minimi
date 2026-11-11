// Builds the agent's parts once per server process and hands them out.
//
// Kept on globalThis so Next.js reloading modules in development does not
// open a second copy of memory on every request. A setup problem (a missing
// key) is not kept, so fixing .env and reloading the page works without a
// restart.
//
// In development, a code change reloads this module. The kept runtime was
// built by the old code, so it would keep old objects without new methods
// ("store.deleteChat is not a function"). Each load of this module has its
// own token, and a runtime built under another token is rebuilt.

import { join } from "node:path";
import { readConfig, type Config } from "../config/env.ts";
import { MemoryStore } from "../memory/store.ts";
import { seedDemoChats } from "../memory/demo.ts";
import { OpenRouterClient } from "../model/openrouter.ts";
import { SnapshotStore } from "../search/snapshots.ts";
import { TavilyBackend } from "../search/tavily.ts";
import { HttpFetcher } from "../search/http-fetcher.ts";
import { BudgetedModel, BudgetedSearch, DailyBudget } from "../guardrails/budget.ts";
import type { TurnDeps } from "../agent/turn.ts";

export type Runtime =
  | {
      ok: true;
      config: Config;
      store: MemoryStore;
      /** The parts a turn needs, with "today" read in the user's time zone. */
      deps: (timeZone: string) => TurnDeps;
      warnings: string[];
    }
  | { ok: false; problems: string[] };

const BUILD = Symbol("minimi runtime");
const holder = globalThis as unknown as { __minimiRuntime?: { build: symbol; runtime: Promise<Runtime> } };

async function build(): Promise<Runtime> {
  const result = readConfig(process.env);
  if (!result.ok) return { ok: false, problems: result.problems };
  const config = result.config;

  const root = process.env.MEMORY_DIR ?? join(process.cwd(), "memory");
  const { store, warnings } = await MemoryStore.open(root);
  // A fresh copy gets the demo chats from demo/, once. Dates are read in this
  // computer's time zone: the app runs on the user's own machine.
  const demo = await seedDemoChats({
    demoDir: join(process.cwd(), "demo"),
    memoryDir: root,
    store,
    now: new Date(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  const pages = await SnapshotStore.open(join(root, "pages"));
  const now = () => new Date();

  const model = new OpenRouterClient(config.openRouterApiKey, config.model);
  const guard = config.guardModel ? new OpenRouterClient(config.openRouterApiKey, config.guardModel) : undefined;
  const search = new TavilyBackend(config.tavilyApiKey);
  const fetcher = new HttpFetcher();

  const deps = (timeZone: string): TurnDeps => {
    // The day the caps reset follows the user's own midnight.
    const budget = new DailyBudget(join(root, "usage"), { searches: config.dailySearches, modelUsd: config.dailyModelUsd }, timeZone, now);
    return {
      model: new BudgetedModel(model, budget),
      ...(guard ? { guard: new BudgetedModel(guard, budget) } : {}),
      store,
      search: { backend: new BudgetedSearch(search, budget), fetcher, snapshots: pages.store, now, timeZone },
      now,
      timeZone,
    };
  };

  return { ok: true, config, store, deps, warnings: [...warnings, ...demo.warnings, ...pages.warnings] };
}

export async function getRuntime(): Promise<Runtime> {
  if (holder.__minimiRuntime?.build !== BUILD) holder.__minimiRuntime = { build: BUILD, runtime: build() };
  const runtime = await holder.__minimiRuntime.runtime;
  if (!runtime.ok) holder.__minimiRuntime = undefined;
  return runtime;
}

/** A time zone the browser sent, or UTC if it is not one Node knows. */
export function safeTimeZone(value: unknown): string {
  if (typeof value !== "string" || value.length > 64) return "UTC";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}
