/**
 * The matcher's output shape.
 *
 * `docs/architecture.md` used to say a matching tier could sit "behind
 * `ConceptIndex.byAlias`, callers do not change" — that guidance is wrong
 * and is corrected here. `byAlias` returns `Concept | undefined`, which
 * cannot represent "two equally plausible concepts, no way to tell them
 * apart deterministically". `messy.html`'s `fld_7` exists specifically to
 * demand that answer, so the matcher returns a candidate set instead of a
 * single optional value.
 */

import type { Certainty } from "../agent/types";

export const MatchTier = {
  /** A WHATWG `autocomplete` token. Highest precision, zero string cost. */
  AUTOCOMPLETE: "autocomplete",
  /** The field's `kind` uniquely determines the concept's `expects`. */
  TYPE_NARROWING: "type_narrowing",
  /** Exact, normalised match against a concept's alias list. */
  ALIAS: "alias",
  /** Alias tokens fully covered by the field's `placeholder`. */
  PLACEHOLDER: "placeholder",
  /** Alias tokens fully covered by the field's label + nearby text. */
  NEARBY_TEXT: "nearby_text",
  /** A model mapped an otherwise unresolved field to an ontology concept key. */
  MODEL: "model",
} as const;

export type MatchTier = (typeof MatchTier)[keyof typeof MatchTier];

export interface MatchCandidate {
  readonly conceptKey: string;
  readonly tier: MatchTier;
  /** 0-1. Relative confidence within the tier; see `~/core/matching/confidence`. */
  readonly score: number;
}

export interface MatchResult {
  readonly candidates: readonly MatchCandidate[];
  readonly certainty: Certainty;
}
