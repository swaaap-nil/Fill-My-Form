import type { z } from "zod";
import type { AppError } from "../errors";
import type { Logger } from "../logging";
import type { ActionRisk } from "../policy/types";

/**
 * Typed tools are the only way the agent touches the world.
 *
 * The model never receives a JavaScript evaluator, a DOM handle or a raw
 * network client. It receives a name and a JSON schema, and it proposes
 * arguments. Those arguments are untrusted input: they are parsed against
 * `input`, checked against policy, executed by our code, and the result is
 * parsed against `output` before the agent sees it.
 *
 *   model -> schema validation -> policy -> execute -> result validation -> agent
 *
 * See docs/agent.md.
 */

/** Capability domains. Tools are exposed to the model one domain at a time. */
export const CapabilityDomain = {
  BROWSER: "browser",
  MEMORY: "memory",
  FILES: "files",
  USER: "user",
} as const;

export type CapabilityDomain =
  (typeof CapabilityDomain)[keyof typeof CapabilityDomain];

/**
 * What a tool is handed at execution time. Deliberately narrow: no memory
 * store, no page handle, no fetch. A tool that needs one of those receives it
 * through its own closure when it is registered, so the capability is granted
 * at wiring time rather than assumed at call time.
 */
export interface ToolContext {
  readonly runId: string;
  readonly origin: string;
  readonly logger: Logger;
  readonly signal: AbortSignal;
}

export type ToolResult<O> =
  | { readonly ok: true; readonly value: O }
  | { readonly ok: false; readonly error: AppError };

export interface ToolDefinition<I = unknown, O = unknown> {
  readonly name: string;
  readonly domain: CapabilityDomain;
  /** Shown to the model. Should read as an API doc, not as a prompt. */
  readonly description: string;
  readonly input: z.ZodType<I>;
  readonly output: z.ZodType<O>;
  readonly risk: ActionRisk;
  execute(input: I, context: ToolContext): Promise<O>;
}

/** The shape handed to an LLM provider. Never includes `execute`. */
export interface ToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly parameters: unknown;
}

export interface ToolRegistry {
  register<I, O>(tool: ToolDefinition<I, O>): void;
  get(name: string): ToolDefinition | undefined;
  /**
   * Progressive disclosure. The runtime asks for the domains relevant to the
   * current phase; anything else is invisible to the model. There is no
   * "list everything" for prompt construction on purpose.
   */
  describe(domains: readonly CapabilityDomain[]): readonly ToolDescriptor[];
  /** Diagnostics and tests only. Not for prompt construction. */
  names(): readonly string[];
}
