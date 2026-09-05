/**
 * The MEMORY capability domain's only tools: both read-only.
 *
 * This file exists to make the trap in the phase 1c brief structurally
 * hard to fall into — "just add a `memory.set` tool for onboarding" — by
 * being the one place the domain's tool list is assembled. A test
 * (`src/core/tests/memory-tools.test.ts`) asserts this list, by name,
 * never grows a write capability; growing it here without touching that
 * test is not possible; touching that test is a decision someone has to
 * make on purpose.
 *
 * The actual write path is `~/core/memory/write-service`, called directly
 * by the side panel — never through `executeTool`. See `docs/memory.md`.
 */

import { z } from "zod";
import { ActionRisk } from "../policy/types";
import { CapabilityDomain, type ToolDefinition } from "../tools/types";
import type { MemoryStore } from "./store";
import { MemorySource } from "./types";

const MEMORY_SOURCE_VALUES = [
  MemorySource.USER_PROVIDED,
  MemorySource.USER_CONFIRMED,
  MemorySource.OBSERVED,
  MemorySource.INFERRED,
] as const;

const memoryValueSchema: z.ZodType<
  string | number | boolean | readonly string[] | Record<string, unknown>
> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),
    z.record(z.string(), memoryValueSchema),
  ]),
);

const memoryProvenanceSchema = z.object({
  source: z.enum(MEMORY_SOURCE_VALUES),
  confidence: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  confirmedByUser: z.boolean(),
  expiresAt: z.string().optional(),
  freshnessRule: z.string().optional(),
  evidence: z.string().optional(),
});

const memoryItemSchema = z.object({
  profileId: z.string(),
  key: z.string(),
  value: memoryValueSchema,
  provenance: memoryProvenanceSchema,
  label: z.string().optional(),
  schemaVersion: z.number(),
});

const searchMemoryInput = z.object({
  profileId: z.string(),
  keys: z.array(z.string()).optional(),
  prefix: z.string().optional(),
  text: z.string().optional(),
  minConfidence: z.number().optional(),
  sources: z.array(z.enum(MEMORY_SOURCE_VALUES)).optional(),
  limit: z.number().optional(),
});

const getMemoryInput = z.object({
  profileId: z.string(),
  key: z.string(),
});

const searchMemoryTool = (
  store: MemoryStore,
): ToolDefinition<z.infer<typeof searchMemoryInput>, unknown> => ({
  name: "search_memory",
  domain: CapabilityDomain.MEMORY,
  description:
    "Search the user's personal memory by key prefix, free text, confidence, or source. Read-only.",
  input: searchMemoryInput,
  output: z.array(memoryItemSchema),
  // Retrieval discloses personal data into the agent's context by design;
  // that is not "reversible, non-identifying" (LOW), so this is
  // deliberately not the default risk for a read.
  risk: ActionRisk.MEDIUM,
  execute: (input) => store.search(input),
});

const getMemoryTool = (
  store: MemoryStore,
): ToolDefinition<z.infer<typeof getMemoryInput>, unknown> => ({
  name: "get_memory",
  domain: CapabilityDomain.MEMORY,
  description:
    "Get one item from the user's personal memory by its exact key. Read-only.",
  input: getMemoryInput,
  output: memoryItemSchema.nullable(),
  risk: ActionRisk.LOW,
  execute: (input) => store.get(input.profileId, input.key),
});

/** Registered under `CapabilityDomain.MEMORY`. Both read-only. */
export const createMemoryTools = (store: MemoryStore): ToolDefinition[] => [
  searchMemoryTool(store) as ToolDefinition,
  getMemoryTool(store) as ToolDefinition,
];
