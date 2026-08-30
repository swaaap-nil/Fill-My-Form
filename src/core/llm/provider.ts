import type { z } from "zod";
import type { ToolDescriptor } from "../tools/types";

/**
 * The one interface business logic knows about.
 *
 * No file under `src/core` other than `llm/ai-sdk.ts` may import a model SDK —
 * `biome.json` enforces it. Swapping OpenAI for Anthropic, a local model or
 * WebLLM is a new file implementing `LLMProvider`, plus a line where providers
 * are wired. Nothing in the agent changes.
 *
 * The model is an untrusted reasoning component. Everything it returns is
 * parsed before use.
 */

export const LLMRole = {
  SYSTEM: "system",
  USER: "user",
  ASSISTANT: "assistant",
} as const;

export type LLMRole = (typeof LLMRole)[keyof typeof LLMRole];

export interface LLMMessage {
  readonly role: LLMRole;
  readonly content: string;
}

/** Reuses the tool registry's descriptor: one definition, not two. */
export type LLMToolDefinition = ToolDescriptor;

export interface LLMUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export const FinishReason = {
  STOP: "stop",
  LENGTH: "length",
  TOOL_CALL: "tool_call",
  CONTENT_FILTER: "content_filter",
  ERROR: "error",
} as const;

export type FinishReason = (typeof FinishReason)[keyof typeof FinishReason];

export interface LLMToolCall {
  readonly id: string;
  readonly name: string;
  /** Untrusted. Parse against the tool's input schema before acting. */
  readonly input: unknown;
}

export interface LLMRequest<T = string> {
  readonly system?: string;
  readonly messages: readonly LLMMessage[];
  /**
   * When present the provider must return a value matching this schema, and
   * the provider — not the caller — is responsible for validating it.
   */
  readonly schema?: z.ZodType<T>;
  /** Only the tools the current phase is allowed to see. */
  readonly tools?: readonly LLMToolDefinition[];
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly signal?: AbortSignal;
}

export interface LLMResponse<T = string> {
  /** Parsed structured output when `schema` was supplied, else the raw text. */
  readonly value: T;
  readonly text: string;
  readonly toolCalls: readonly LLMToolCall[];
  readonly finishReason: FinishReason;
  readonly usage: LLMUsage;
}

export interface LLMProvider {
  /** Stable identifier for logs and evaluation runs, e.g. "mock", "chrome-ai". */
  readonly id: string;
  generate<T = string>(request: LLMRequest<T>): Promise<LLMResponse<T>>;
}
