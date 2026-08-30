import { z } from "zod";
import { ToolExecutionError, ValidationError } from "../errors";
import type {
  ToolContext,
  ToolDefinition,
  ToolDescriptor,
  ToolRegistry,
  ToolResult,
} from "./types";

export const createToolRegistry = (): ToolRegistry => {
  const tools = new Map<string, ToolDefinition>();

  return {
    register(tool) {
      if (tools.has(tool.name)) {
        throw new Error(`Tool "${tool.name}" is already registered.`);
      }
      tools.set(tool.name, tool as ToolDefinition);
    },
    get: (name) => tools.get(name),
    describe(domains): readonly ToolDescriptor[] {
      const allowed = new Set(domains);
      return [...tools.values()]
        .filter((tool) => allowed.has(tool.domain))
        .map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: z.toJSONSchema(tool.input),
        }));
    },
    names: () => [...tools.keys()],
  };
};

/**
 * The single path from a model-proposed action to an executed tool.
 *
 * Every stage can reject, and rejection is a normal outcome rather than an
 * exception: the runtime feeds the failure back to the agent as an observation.
 * Policy evaluation is not performed here — the caller decides *whether* the
 * action is permitted before calling this, which decides *how* it runs safely.
 */
export const executeTool = async (
  registry: ToolRegistry,
  name: string,
  rawInput: unknown,
  context: ToolContext,
): Promise<ToolResult<unknown>> => {
  const tool = registry.get(name);
  if (!tool) {
    return {
      ok: false,
      error: ToolExecutionError(`Unknown tool "${name}".`, {
        context: { toolName: name },
      }),
    };
  }

  // 1. The model's arguments are untrusted input.
  const parsedInput = tool.input.safeParse(rawInput);
  if (!parsedInput.success) {
    return {
      ok: false,
      error: ValidationError(`Invalid arguments for tool "${name}".`, {
        context: { toolName: name, issues: parsedInput.error.issues.length },
      }),
    };
  }

  const startedAt = performance.now();
  let raw: unknown;
  try {
    // 2. Our code runs, with only the capabilities granted at registration.
    raw = await tool.execute(parsedInput.data, context);
  } catch (cause) {
    return {
      ok: false,
      error: ToolExecutionError(`Tool "${name}" threw.`, {
        context: { toolName: name, domain: tool.domain },
        cause,
      }),
    };
  }

  // 3. The result is validated too, so a misbehaving adapter cannot widen
  //    what the agent believes it received.
  const parsedOutput = tool.output.safeParse(raw);
  if (!parsedOutput.success) {
    return {
      ok: false,
      error: ValidationError(`Tool "${name}" returned an unexpected shape.`, {
        context: { toolName: name },
      }),
    };
  }

  context.logger.debug("tool executed", {
    toolName: name,
    domain: tool.domain,
    durationMs: Math.round(performance.now() - startedAt),
    status: "ok",
  });

  return { ok: true, value: parsedOutput.data };
};
