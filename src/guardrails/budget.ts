// Daily spending caps, so a long session or a loop cannot burn search
// credits or model money.
//
//   memory/usage/2026-11-11.json   { "searches": 12, "modelUsd": 0.0381 }
//
// Wrappers, not changes to the agent: BudgetedSearch and BudgetedModel sit in
// front of the real search provider and model, count what is used, and refuse
// with a plain message once today's cap is reached. The day is the user's
// calendar day, so the count resets at their midnight.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { todayIn } from "../memory/dates.ts";
import { writeFileSafely } from "../memory/files.ts";
import { ModelError, type ModelClient, type ModelReply, type ModelRequest } from "../model/types.ts";
import { SearchError, type SearchBackend, type SearchHit, type SearchOptions } from "../search/types.ts";

export type DailyLimits = { searches: number; modelUsd: number };
type Usage = { searches: number; modelUsd: number };

export class DailyBudget {
  private readonly dir: string;
  private readonly timeZone: string;
  private readonly now: () => Date;
  readonly limits: DailyLimits;
  private day = "";
  private usage: Usage = { searches: 0, modelUsd: 0 };

  constructor(dir: string, limits: DailyLimits, timeZone: string, now: () => Date = () => new Date()) {
    this.dir = dir;
    this.limits = limits;
    this.timeZone = timeZone;
    this.now = now;
  }

  /** Loads today's counts, starting fresh on a new day. */
  private async today(): Promise<Usage> {
    const day = todayIn(this.timeZone, this.now());
    if (day !== this.day) {
      this.day = day;
      try {
        const saved = JSON.parse(await readFile(join(this.dir, `${day}.json`), "utf8")) as Partial<Usage>;
        this.usage = { searches: Number(saved.searches) || 0, modelUsd: Number(saved.modelUsd) || 0 };
      } catch {
        this.usage = { searches: 0, modelUsd: 0 };
      }
    }
    return this.usage;
  }

  private save(): Promise<void> {
    return writeFileSafely(join(this.dir, `${this.day}.json`), `${JSON.stringify(this.usage, null, 2)}\n`);
  }

  async searchesLeft(): Promise<number> {
    return Math.max(0, this.limits.searches - (await this.today()).searches);
  }

  async spendSearch(): Promise<void> {
    (await this.today()).searches += 1;
    await this.save();
  }

  async modelUsdLeft(): Promise<number> {
    return Math.max(0, this.limits.modelUsd - (await this.today()).modelUsd);
  }

  async spendModel(usd: number): Promise<void> {
    (await this.today()).modelUsd += usd;
    await this.save();
  }
}

export class BudgetedSearch implements SearchBackend {
  private readonly inner: SearchBackend;
  private readonly budget: DailyBudget;

  constructor(inner: SearchBackend, budget: DailyBudget) {
    this.inner = inner;
    this.budget = budget;
  }

  async search(query: string, options: SearchOptions): Promise<SearchHit[]> {
    if ((await this.budget.searchesLeft()) < 1) {
      throw new SearchError(
        "quota",
        `Today's search limit (${this.budget.limits.searches}) is reached, so web search is off until tomorrow. Raise DAILY_SEARCH_LIMIT in .env to allow more.`,
      );
    }
    await this.budget.spendSearch();
    return this.inner.search(query, options);
  }
}

export class BudgetedModel implements ModelClient {
  private readonly inner: ModelClient;
  private readonly budget: DailyBudget;

  constructor(inner: ModelClient, budget: DailyBudget) {
    this.inner = inner;
    this.budget = budget;
  }

  async complete(request: ModelRequest): Promise<ModelReply> {
    if ((await this.budget.modelUsdLeft()) <= 0) {
      throw new ModelError(
        "credits",
        `Today's model spending cap ($${this.budget.limits.modelUsd.toFixed(2)}) is reached. Raise DAILY_MODEL_SPEND_USD in .env to allow more.`,
      );
    }
    const reply = await this.inner.complete(request);
    await this.budget.spendModel(reply.usage.cost);
    return reply;
  }
}
