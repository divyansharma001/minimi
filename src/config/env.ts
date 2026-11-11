// Reads and checks settings from the environment in one place.
// Everything else asks this module, so a missing key shows up as one clear
// message on screen instead of a stack trace deep inside a request.

export const DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash";
export const DEFAULT_GUARD_MODEL = "meta-llama/llama-guard-4-12b";
export const DEFAULT_DAILY_SEARCHES = 50;
export const DEFAULT_DAILY_MODEL_USD = 0.5;

export type Config = {
  openRouterApiKey: string;
  tavilyApiKey: string;
  model: string;
  /** null when the safety check is turned off with GUARD_MODEL=off. */
  guardModel: string | null;
  dailySearches: number;
  dailyModelUsd: number;
};

export type ConfigResult =
  | { ok: true; config: Config }
  | { ok: false; problems: string[] };

type Env = Record<string, string | undefined>;

export function readConfig(env: Env): ConfigResult {
  const problems: string[] = [];

  const openRouterApiKey = env.OPENROUTER_API_KEY?.trim() ?? "";
  if (openRouterApiKey === "") {
    problems.push(
      "OPENROUTER_API_KEY is missing. Copy .env.example to .env and add a key from https://openrouter.ai/keys",
    );
  }

  const tavilyApiKey = env.TAVILY_API_KEY?.trim() ?? "";
  if (tavilyApiKey === "") {
    problems.push(
      "TAVILY_API_KEY is missing. Add a free key from https://app.tavily.com (1,000 searches a month, no card).",
    );
  }

  const model = env.MODEL?.trim() || DEFAULT_MODEL;
  const guardSetting = env.GUARD_MODEL?.trim() || DEFAULT_GUARD_MODEL;
  const guardModel = /^(off|none|false|0)$/i.test(guardSetting) ? null : guardSetting;

  const number = (name: string, fallback: number) => {
    const raw = env[name]?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      problems.push(`${name} must be a number of 0 or more, not "${raw}".`);
      return fallback;
    }
    return value;
  };
  const dailySearches = number("DAILY_SEARCH_LIMIT", DEFAULT_DAILY_SEARCHES);
  const dailyModelUsd = number("DAILY_MODEL_SPEND_USD", DEFAULT_DAILY_MODEL_USD);

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, config: { openRouterApiKey, tavilyApiKey, model, guardModel, dailySearches, dailyModelUsd } };
}
