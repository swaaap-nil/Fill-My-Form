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

/** Ontology concept key. Imports and UI writes reject unknown keys. */
export type MemoryKey = string;

/**
 * Which person a memory item is about. `identity.first_name` assumes one
 * person, but the Indian government-form use case routinely means filling
 * on behalf of a spouse, a child or a parent — so the key space is
 * qualified by profile from day one rather than bolted on later, which
 * would mean migrating every stored key and every call site at once.
 *
 * `DEFAULT_PROFILE_ID` is the user themselves; nothing in v1's UI creates a
 * second profile, but every store method already takes one so that adding
 * the "fill this for my son" flow later is new UI over an existing
 * dimension, not a schema migration.
 */
export type ProfileId = string;
export const DEFAULT_PROFILE_ID: ProfileId = "self";

/**
 * Bumped whenever `MemoryItem`'s shape changes incompatibly. A backend
 * reads this on load and runs any migrations older items need; see
 * `~/core/memory/in-memory.ts` for the (currently trivial, since this is
 * version 1) migration seam. Required rather than defaulted so a
 * hand-constructed item can never silently skip the check.
 */
export type MemorySchemaVersion = number;
export const CURRENT_MEMORY_SCHEMA_VERSION: MemorySchemaVersion = 2;

/** JSON-representable, so a run stays serialisable and resumable. */
export interface FileReference {
  readonly kind: "file_ref";
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
  readonly artifactKind?: "original" | "derived";
  readonly derivedFrom?: string;
  readonly expiresAt?: string;
}

export type MemoryValue =
  | string
  | number
  | boolean
  | null
  | readonly MemoryValue[]
  | FileReference
  | { readonly [key: string]: MemoryValue | undefined };

export const isFileReference = (value: unknown): value is FileReference => {
  if (!value || typeof value !== "object") return false;
  const ref = value as FileReference;
  return (
    ref.kind === "file_ref" &&
    typeof ref.id === "string" &&
    ref.id.length > 0 &&
    typeof ref.name === "string" &&
    ref.name.length > 0 &&
    typeof ref.mimeType === "string" &&
    typeof ref.sizeBytes === "number" &&
    Number.isFinite(ref.sizeBytes) &&
    ref.sizeBytes >= 0 &&
    typeof ref.createdAt === "string" &&
    (ref.artifactKind === undefined ||
      ref.artifactKind === "original" ||
      ref.artifactKind === "derived") &&
    (ref.derivedFrom === undefined || typeof ref.derivedFrom === "string") &&
    (ref.expiresAt === undefined || typeof ref.expiresAt === "string")
  );
};

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
  readonly profileId: ProfileId;
  readonly key: MemoryKey;
  readonly value: MemoryValue;
  readonly provenance: MemoryProvenance;
  /** Human label for review UI. Falls back to the ontology concept label. */
  readonly label?: string;
  readonly schemaVersion: MemorySchemaVersion;
}

export interface MemoryQuery {
  readonly profileId: ProfileId;
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
