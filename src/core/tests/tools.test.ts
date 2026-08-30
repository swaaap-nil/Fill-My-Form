import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { ErrorCode } from "~/core/errors";
import { nullLogger } from "~/core/logging";
import { ActionRisk } from "~/core/policy/types";
import { createToolRegistry, executeTool } from "~/core/tools/registry";
import { CapabilityDomain, type ToolContext } from "~/core/tools/types";

const context: ToolContext = {
  runId: "run_test",
  origin: "https://example.test",
  logger: nullLogger,
  signal: AbortSignal.timeout(1_000),
};

const fillField = {
  name: "fill_field",
  domain: CapabilityDomain.BROWSER,
  description: "Type a value into a field.",
  input: z.object({ fieldId: z.string().min(1), value: z.string() }),
  output: z.object({ applied: z.boolean() }),
  risk: ActionRisk.MEDIUM,
  execute: async () => ({ applied: true }),
} as const;

const searchMemory = {
  name: "search_memory",
  domain: CapabilityDomain.MEMORY,
  description: "Find memory items matching a query.",
  input: z.object({ text: z.string() }),
  output: z.object({ count: z.number() }),
  risk: ActionRisk.LOW,
  execute: async () => ({ count: 0 }),
} as const;

const registry = () => {
  const r = createToolRegistry();
  r.register(fillField);
  r.register(searchMemory);
  return r;
};

describe("progressive disclosure", () => {
  it("exposes only the domains the current phase asked for", () => {
    const described = registry().describe([CapabilityDomain.MEMORY]);

    expect(described.map((t) => t.name)).toEqual(["search_memory"]);
  });

  it("hides every tool when no domain is granted", () => {
    expect(registry().describe([])).toHaveLength(0);
  });

  it("never leaks execute to the model-facing descriptor", () => {
    const [described] = registry().describe([CapabilityDomain.BROWSER]);

    expect(described).toBeDefined();
    expect(described).not.toHaveProperty("execute");
    expect(described?.parameters).toMatchObject({ type: "object" });
  });

  it("refuses duplicate registrations", () => {
    const r = registry();
    expect(() => r.register(fillField)).toThrow(/already registered/);
  });
});

describe("executeTool", () => {
  it("rejects model arguments that do not match the schema", async () => {
    const result = await executeTool(
      registry(),
      "fill_field",
      { fieldId: 42, value: null },
      context,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ErrorCode.VALIDATION);
  });

  it("rejects a missing required argument rather than defaulting it", async () => {
    const result = await executeTool(
      registry(),
      "fill_field",
      { fieldId: "f1" },
      context,
    );

    expect(result.ok).toBe(false);
  });

  it("rejects an unknown tool name", async () => {
    const result = await executeTool(registry(), "eval_js", {}, context);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ErrorCode.TOOL_EXECUTION);
  });

  it("runs a valid call and returns the parsed value", async () => {
    const result = await executeTool(
      registry(),
      "fill_field",
      { fieldId: "f1", value: "hello" },
      context,
    );

    expect(result).toEqual({ ok: true, value: { applied: true } });
  });

  it("catches a throwing tool instead of unwinding the agent", async () => {
    const r = createToolRegistry();
    r.register({
      ...fillField,
      execute: async () => {
        throw new Error("detached node");
      },
    });

    const result = await executeTool(
      r,
      "fill_field",
      { fieldId: "f1", value: "x" },
      context,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.TOOL_EXECUTION);
      expect(result.error.recoverable).toBe(true);
    }
  });

  it("rejects a result that does not match the output schema", async () => {
    const r = createToolRegistry();
    r.register({
      ...fillField,
      execute: async () => ({ applied: "yes" }) as never,
    });

    const result = await executeTool(
      r,
      "fill_field",
      { fieldId: "f1", value: "x" },
      context,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ErrorCode.VALIDATION);
  });
});
