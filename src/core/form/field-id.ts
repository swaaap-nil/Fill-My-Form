/**
 * The `FieldId` scheme.
 *
 * Shape: `${formIndex}/${hash(name || domId || "")}/${occurrenceIndex}`.
 *
 * Why this shape, not the DOM node itself or a random uuid:
 *
 * - **Non-personal.** The hash covers `name` or `id` — attributes the page
 *   author chose, never a label, placeholder or anything the user typed.
 *   `fieldId` sits in `LogFields`'s allowlist, so this is load-bearing.
 * - **Stable across re-observation and reload**, because it is a pure
 *   function of attributes the page already declares, not of DOM node
 *   identity or a freshly-generated id.
 * - **Stable when unrelated siblings are injected.** `occurrenceIndex`
 *   counts only among candidates that share the same `(formIndex, key)`
 *   pair, in document order. Inserting a field with a *different* key
 *   before an existing one (dynamic.html's step transition) does not shift
 *   the existing field's occurrence count, because that count only advances
 *   when a same-key candidate precedes it. A naive positional index over
 *   *all* controls would break exactly this case.
 * - **Distinct for two controls that differ only by position** — two
 *   controls with no `name` and no `id` both hash the empty key, and
 *   `occurrenceIndex` (0, 1, 2, …) disambiguates them by document order.
 *
 * This lives in `src/core` because it is pure: no DOM, testable under plain
 * `bun test`. The extractor in `src/lib/form/extract.ts` is the only caller.
 */

import type { FieldId } from "./types";

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a over a short string. Deterministic, no crypto dependency needed. */
export const hashFieldKey = (key: string): string => {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

/** The identity key for a control: its `name`, falling back to its DOM `id`. */
export const fieldKeyOf = (name?: string, domId?: string): string =>
  name || domId || "";

export interface FieldIdCandidate {
  /** Index of the `<form>` this control belongs to, in document order. */
  readonly formIndex: number;
  readonly name?: string;
  readonly domId?: string;
}

const computeFieldId = (
  candidate: FieldIdCandidate,
  occurrenceIndex: number,
): FieldId => {
  const key = fieldKeyOf(candidate.name, candidate.domId);
  return `${candidate.formIndex}/${hashFieldKey(key)}/${occurrenceIndex}`;
};

/**
 * Assigns a `FieldId` to each candidate, in the order given. Pure: the same
 * input list always produces the same output list, and — the property that
 * matters — a candidate's id depends only on candidates sharing its
 * `(formIndex, key)` pair that precede it, not on anything else in the list.
 */
export const assignFieldIds = (
  candidates: readonly FieldIdCandidate[],
): FieldId[] => {
  const seen = new Map<string, number>();

  return candidates.map((candidate) => {
    const seenKey = `${candidate.formIndex}:${fieldKeyOf(candidate.name, candidate.domId)}`;
    const occurrenceIndex = seen.get(seenKey) ?? 0;
    seen.set(seenKey, occurrenceIndex + 1);
    return computeFieldId(candidate, occurrenceIndex);
  });
};
