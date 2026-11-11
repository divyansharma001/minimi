// The model, as the agent sees it: send messages, get text or tool calls back.
// OpenRouter in the app, a scripted fake in tests.

export type ToolCall = { id: string; name: string; arguments: string };

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolDefinition = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ModelRequest = {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  /** Forces the reply to be JSON matching this schema. Not used with tools. */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  maxTokens?: number;
  /** How hard the model thinks before replying. "none" turns thinking off. */
  effort?: "none" | "low" | "medium" | "high";
  /** Gives up after this long. Small calls get short limits, so a stalled provider cannot hold a turn for minutes. */
  timeoutMs?: number;
};

export type Usage = { inputTokens: number; outputTokens: number; cost: number };

export type ModelReply = {
  content: string;
  toolCalls: ToolCall[];
  usage: Usage;
  /** Which company served the request, when the router says. */
  provider?: string;
  /** Why the model stopped: "length" means it ran out of tokens mid-reply. */
  finishReason?: string;
};

export interface ModelClient {
  complete(request: ModelRequest): Promise<ModelReply>;
}

export type ModelFailure = "auth" | "credits" | "rate-limit" | "timeout" | "provider" | "bad-reply";

export class ModelError extends Error {
  readonly reason: ModelFailure;

  constructor(reason: ModelFailure, message: string) {
    super(message);
    this.reason = reason;
  }
}
