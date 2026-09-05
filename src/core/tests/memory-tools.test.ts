import { describe, expect, it } from "bun:test";
import { createInMemoryMemoryStore } from "~/core/memory/in-memory";
import { createMemoryTools } from "~/core/memory/tools";
import { createToolRegistry } from "~/core/tools/registry";
import { CapabilityDomain } from "~/core/tools/types";

/**
 * `docs/memory.md`'s "no set_memory tool" guarantee is only real if the
 * MEMORY domain's tool list is exactly what this test says it is. Growing
 * that list without updating this assertion is not possible — the whole
 * point is to make "just add a memory.set tool for onboarding" a decision
 * someone has to actively make here, not a change that slips in unnoticed.
 */

const READ_ONLY_ALLOWLIST = ["get_memory", "search_memory"];

describe("the MEMORY capability domain", () => {
  it("contains exactly the known read-only allowlist, nothing else", () => {
    const store = createInMemoryMemoryStore();
    const registry = createToolRegistry();
    for (const tool of createMemoryTools(store)) registry.register(tool);

    const names = registry
      .describe([CapabilityDomain.MEMORY])
      .map((t) => t.name)
      .sort();

    expect(names).toEqual(READ_ONLY_ALLOWLIST.slice().sort());
  });

  it("registers nothing whose name suggests a write capability", () => {
    const store = createInMemoryMemoryStore();
    const registry = createToolRegistry();
    for (const tool of createMemoryTools(store)) registry.register(tool);

    const names = registry
      .describe([CapabilityDomain.MEMORY])
      .map((t) => t.name);
    const writeLike = /set|write|delete|update|remove|clear/i;

    expect(names.some((name) => writeLike.test(name))).toBe(false);
  });

  it("is invisible outside its own domain", () => {
    const store = createInMemoryMemoryStore();
    const registry = createToolRegistry();
    for (const tool of createMemoryTools(store)) registry.register(tool);

    expect(registry.describe([CapabilityDomain.BROWSER])).toEqual([]);
  });
});
