// Calls models through OpenRouter's chat completions API.
// https://openrouter.ai/docs
//
// Plain fetch, no SDK: one request shape, every field visible.
//
// Routing rules sent with every request:
// - require_parameters: only providers that support everything we send. Most
//   important for the JSON schema: a provider that ignores it would return
//   free text the checks cannot read.
// - data_collection "deny": chats are personal, so skip providers that keep
//   prompts for training.
// - max_price: never pay more than this per 1M tokens, whatever the router picks.

import {
  ModelError,
  type ModelClient,
  type ModelReply,
  type ModelRequest,
  type ToolCall,
} from "./types.ts";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export type OpenRouterOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Dollars per 1M tokens. */
  maxPrice?: { prompt: number; completion: number };
};

type RawToolCall = { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
type RawReply = {
  provider?: string;
  choices?: { message?: { content?: unknown; tool_calls?: RawToolCall[] }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  error?: { message?: string };
};

export class OpenRouterClient implements ModelClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxPrice: { prompt: number; completion: number };

  constructor(apiKey: string, model: string, options: OpenRouterOptions = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 90_000;
    this.maxPrice = options.maxPrice ?? { prompt: 0.5, completion: 2 };
  }

  async complete(request: ModelRequest): Promise<ModelReply> {
    const body = {
      model: this.model,
      messages: request.messages,
      ...(request.tools?.length ? { tools: request.tools, tool_choice: "auto" } : {}),
      ...(request.jsonSchema
        ? {
            response_format: {
              type: "json_schema",
              json_schema: { name: request.jsonSchema.name, strict: true, schema: request.jsonSchema.schema },
            },
          }
        : {}),
      ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
      ...(request.effort ? { reasoning: { effort: request.effort, exclude: true } } : {}),
      provider: { require_parameters: true, data_collection: "deny", max_price: this.maxPrice },
    };

    let response = await this.post(body);
    if (response.status === 429 || response.status >= 500) {
      // One quick retry: the router picks another provider.
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      response = await this.post(body);
    }
    const data = (await response.json().catch(() => ({}))) as RawReply;
    if (!response.ok) throw this.errorFor(response.status, data.error?.message);

    const choice = data.choices?.[0];
    if (!choice?.message) throw new ModelError("bad-reply", "The model sent back an empty reply.");
    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).flatMap((call, i) =>
      typeof call.function?.name === "string"
        ? [
            {
              id: typeof call.id === "string" ? call.id : `call_${i}`,
              name: call.function.name,
              arguments: typeof call.function.arguments === "string" ? call.function.arguments : "{}",
            },
          ]
        : [],
    );
    return {
      content: typeof choice.message.content === "string" ? choice.message.content : "",
      toolCalls,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        cost: data.usage?.cost ?? 0,
      },
      ...(data.provider ? { provider: data.provider } : {}),
    };
  }

  private async post(body: unknown): Promise<Response> {
    try {
      return await this.fetchImpl(ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
          "x-title": "minimi",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const timedOut = (error as Error).name === "TimeoutError";
      throw new ModelError(
        timedOut ? "timeout" : "provider",
        timedOut ? `The model did not answer within ${this.timeoutMs / 1000} seconds.` : "Could not reach OpenRouter.",
      );
    }
  }

  private errorFor(status: number, detail?: string): ModelError {
    switch (status) {
      case 401:
        return new ModelError("auth", "OPENROUTER_API_KEY was rejected. Check the key in .env.");
      case 402:
        return new ModelError("credits", "The OpenRouter account is out of credit.");
      case 429:
        return new ModelError("rate-limit", "The model is busy right now. Try again in a minute.");
      default:
        return new ModelError("provider", `The model request failed (${status}). ${detail ?? ""}`.trim());
    }
  }
}
