/**
 * The local field journal.
 *
 * Every field the matcher could not resolve — `unknown` or `ambiguous` —
 * gets recorded here. This is how the ontology grows against reality: the
 * top unmatched labels are the next aliases and concepts to add, ranked by
 * how often people actually hit them.
 *
 * **Local only in v1.** Nothing here is transmitted, no consent is
 * required, no backend exists. Phase 8 adds the consent prompt that
 * unlocks *sending* what is already being collected — by which point there
 * is a corpus and the screening logic below has been in use for months.
 *
 * `UnresolvedField` is a **closed schema with no index signature**, the
 * same discipline as `LogFields` (`~/core/logging`) and the precursor to
 * ADR 007's `SiteObservation`. It is built as a *narrowing* — constructed
 * from the signals we want — never as a *redaction* of a richer object.
 * Redaction fails open the day someone adds a field to the richer object;
 * narrowing fails closed because the type itself cannot represent more.
 */

import type { Certainty } from "../agent/types";
import type { FieldKind } from "../form/types";
import type { MatchTier } from "../matching/types";

/** The matcher only ever files a journal entry when it did not resolve. */
export type UnresolvedCertainty = Extract<Certainty, "unknown" | "ambiguous">;

export interface UnresolvedField {
  /** Registrable origin, never a full URL. */
  readonly origin: string;
  /** From 1a's `FieldId` scheme — non-personal by construction. */
  readonly fieldKey: string;
  readonly normalisedLabel: string;
  readonly kind: FieldKind;
  readonly autocomplete?: string;
  readonly tiersTried: readonly MatchTier[];
  readonly certainty: UnresolvedCertainty;
  readonly count: number;
  readonly lastSeenAt: string;
}
