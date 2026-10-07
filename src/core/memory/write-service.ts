/**
 * The only path by which a user's answer becomes a stored memory value.
 *
 * `docs/memory.md`: there is no `set_memory` tool and there will not be
 * one. The model may *propose* a write (an `ask_user` action, or a filled
 * value awaiting confirmation); the write itself happens here, called by
 * the side panel after the user has actually answered or confirmed —
 * never through `executeTool`, never reachable from model-proposed input.
 *
 * `ask_user` answer / confirmed fill -> side panel/background ->
 * `recordAnswer()` -> `MemoryStore`.
 *
 * Full local-data restore is intentionally separate: import preserves a
 * previously exported store, but UI/model-proposed answers still come through
 * this service.
 *
 * This is intentionally a plain function over the `MemoryStore` interface,
 * not a class or a registered tool: the smaller the surface, the easier it
 * is to see, by inspection, that nothing else in the codebase can write.
 */

import { canonicalizeMemoryValue } from "../fill/value-adapters";
import type { MemoryStore } from "./store";
import type {
  MemoryConfidence,
  MemoryKey,
  MemoryProvenance,
  MemorySource,
  MemoryValue,
  ProfileId,
} from "./types";
import { CURRENT_MEMORY_SCHEMA_VERSION } from "./types";

export interface RecordAnswerInput {
  readonly profileId: ProfileId;
  readonly key: MemoryKey;
  readonly value: MemoryValue;
  /** Human label for review UI. Falls back to the ontology concept label. */
  readonly label?: string;
  /**
   * `USER_PROVIDED` for onboarding; `USER_CONFIRMED` for a proposed fill
   * the user accepted. Both set `confirmedByUser: true` — this is the
   * write path's only opinion on provenance, everything else is passed
   * through.
   */
  readonly source: Extract<MemorySource, "user_provided" | "user_confirmed">;
  /** Defaults to 1: a direct answer is not an inference. */
  readonly confidence?: MemoryConfidence;
  readonly expiresAt?: string;
  readonly freshnessRule?: string;
  readonly evidence?: string;
  /** Injected clock — no reliance on ambient system time in tests. */
  readonly now: string;
}

type UserAnswerMemoryStore = Pick<MemoryStore, "get" | "set">;

export const recordAnswer = async (
  store: UserAnswerMemoryStore,
  input: RecordAnswerInput,
): Promise<void> => {
  const existing = await store.get(input.profileId, input.key);
  const value = canonicalizeMemoryValue(input.key, input.value);

  const provenance: MemoryProvenance = {
    source: input.source,
    confidence: input.confidence ?? 1,
    confirmedByUser: true,
    createdAt: existing?.provenance.createdAt ?? input.now,
    updatedAt: input.now,
    expiresAt: input.expiresAt,
    freshnessRule: input.freshnessRule,
    evidence: input.evidence,
  };

  await store.set({
    profileId: input.profileId,
    key: input.key,
    value,
    label: input.label,
    schemaVersion: CURRENT_MEMORY_SCHEMA_VERSION,
    provenance,
  });
};
