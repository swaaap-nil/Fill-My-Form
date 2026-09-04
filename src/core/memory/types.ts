/**
 * Personal memory. This module is LOCAL-ONLY.
 *
 * Nothing here may reach a network. That is enforced, not merely intended:
 * `biome.json` forbids `src/core/memory/**` from importing any cloud or
 * network client, so a violation fails `bun lint` and therefore CI.
 *
 * The model never mutates memory. It may *propose* a write; the write happens
 * through an application service after policy evaluation and, where required,
 * user confirmation. See docs/memory.md.
 *
 * Nothing here reads the content of a user's file. A file-typed concept stores
 * a reference to a file the user tagged; values that appear on a document are
 * typed by the user, never extracted from it. See ADR 005.
 */

/** Usually an ontology concept key, but free-form keys are permitted. */
export type MemoryKey = string;

/** JSON-representable, so a run stays serialisable and resumable. */
export type MemoryValue =
  | string
  | number
  | boolean
  | readonly string[]
  | { readonly [key: string]: MemoryValue };

/** Where a value came from. Determines how far it can be trusted. */
export const MemorySource = {
  /** The user typed it into our own UI. */
  USER_PROVIDED: "user_provided",
  /** We proposed it and the user explicitly confirmed. */
  USER_CONFIRMED: "user_confirmed",
  /** Observed while the user filled a form themselves. */
  OBSERVED: "observed",
  /** Derived by the system from other memory. Always needs confirmation. */
  INFERRED: "inferred",
} as const;

export type MemorySource = (typeof MemorySource)[keyof typeof MemorySource];

/** 0..1. Anything below the policy threshold requires confirmation. */
export type MemoryConfidence = number;

export interface MemoryProvenance {
  readonly source: MemorySource;
  readonly confidence: MemoryConfidence;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** True once the user has seen and accepted this exact value. */
  readonly confirmedByUser: boolean;
  /**
   * ISO-8601. When this passes, the value stops being trusted silently: it is
   * shown to the user for confirmation rather than filled. Absent means the
   * value does not go stale — a date of birth is correct forever.
   *
   * Derived from the concept's `volatility` and the tunable duration table, so
   * it is a cache of a policy decision, not a fact about the value. See ADR 006.
   */
  readonly expiresAt?: string;
  /**
   * Which rule produced `expiresAt`, so a horizon can be explained in the
   * review UI and re-derived when the duration table changes.
   */
  readonly freshnessRule?: string;
  /**
   * Non-personal note about origin — a document id, an origin, a run id.
   * Never the surrounding text or the value itself.
   */
  readonly evidence?: string;
}

export interface MemoryItem {
  readonly key: MemoryKey;
  readonly value: MemoryValue;
  readonly provenance: MemoryProvenance;
  /** Human label for review UI. Falls back to the ontology concept label. */
  readonly label?: string;
}

export interface MemoryQuery {
  readonly keys?: readonly MemoryKey[];
  /** Dotted-prefix match, e.g. "education." */
  readonly prefix?: string;
  /**
   * Free text. The first implementation will match keys, labels and ontology
   * aliases. Semantic retrieval slots in behind this same field later —
   * callers do not change. See docs/memory.md.
   */
  readonly text?: string;
  readonly minConfidence?: MemoryConfidence;
  readonly sources?: readonly MemorySource[];
  readonly limit?: number;
}
