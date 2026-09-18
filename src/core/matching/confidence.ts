/**
 * Bridges the matcher's `MatchTier` to policy's `ConfidenceLevel`.
 *
 * `Certainty` (known/unknown/ambiguous/requires_confirmation) has no
 * number; `PolicyRequest` needs one. This table is that bridge, and it is
 * security-relevant rather than cosmetic: `defaultPolicy` auto-fills
 * nothing below `ConfidenceLevel.MEDIUM`-with-confirmation, so a tier
 * placed too high here fills a field the matcher was not actually sure of.
 *
 * Only tiers that can produce a *resolved* (`Certainty.KNOWN`) result need
 * an entry — `AMBIGUOUS` and `UNKNOWN` never reach a `PolicyRequest` at
 * all; they become a question for the user instead.
 */

import { ConfidenceLevel } from "../policy/types";
import { MatchTier } from "./types";

export const TIER_CONFIDENCE: Readonly<Record<MatchTier, ConfidenceLevel>> = {
  // A standardised, page-declared token. As close to certain as a
  // deterministic signal gets.
  [MatchTier.AUTOCOMPLETE]: ConfidenceLevel.CERTAIN,
  // An exact, curated alias match on the resolved label.
  [MatchTier.ALIAS]: ConfidenceLevel.HIGH,
  // The field's own type uniquely determined the concept.
  [MatchTier.TYPE_NARROWING]: ConfidenceLevel.HIGH,
  // A developer-authored hint string, not what the label actually says.
  [MatchTier.PLACEHOLDER]: ConfidenceLevel.MEDIUM,
  // Free-form surrounding text. The weakest tier that still resolves.
  [MatchTier.NEARBY_TEXT]: ConfidenceLevel.LOW,
  // Last-resort field-to-concept mapping. It names a concept only; value
  // retrieval and fill policy still go through the same guarded pipeline.
  [MatchTier.MODEL]: ConfidenceLevel.LOW,
};

export const tierToConfidence = (tier: MatchTier): ConfidenceLevel =>
  TIER_CONFIDENCE[tier];

const CONFIDENCE_RANK: Readonly<Record<ConfidenceLevel, number>> = {
  [ConfidenceLevel.LOW]: 0,
  [ConfidenceLevel.MEDIUM]: 1,
  [ConfidenceLevel.HIGH]: 2,
  [ConfidenceLevel.CERTAIN]: 3,
};

/**
 * The weaker of two confidence levels. A field resolved via one tiered
 * cascade (concept matching) and then narrowed by a second (option
 * matching) is only as trustworthy as its weakest link — see
 * `~/core/fill/driver`.
 */
export const minConfidence = (
  a: ConfidenceLevel,
  b: ConfidenceLevel,
): ConfidenceLevel => (CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b);
