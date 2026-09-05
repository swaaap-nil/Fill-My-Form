/**
 * The deterministic matcher: `FormField` -> candidate concepts.
 *
 * Five tiers, cheapest and most precise first. Each tier either finds
 * nothing (fall through to the next), finds exactly one concept (resolved,
 * `Certainty.KNOWN`), or finds two-or-more equally strong concepts
 * (`Certainty.AMBIGUOUS` — stop here; a weaker tier cannot un-confuse a
 * genuine tie, and guessing between them is exactly what "never guess"
 * forbids). Nothing anywhere resolves to `Certainty.REQUIRES_CONFIRMATION`
 * — that is a policy outcome (`~/core/policy`), not a matching one.
 *
 * ## Tier 4 and 5: containment, not exact match
 *
 * Both "placeholder" and "nearby text" ask the same question of different
 * text sources: does every token of some alias appear in the observed
 * text? An alias below {@link MIN_ALIAS_TOKENS_FOR_COVERAGE} tokens is
 * ignored here — a single common word ("employer", "email") is too weak a
 * signal to trust in free text, though it is exactly the shape tier 3
 * trusts when it is the *entire* label.
 *
 * Longest matching alias wins **per concept**, and the same rule breaks
 * ties **across** concepts: if the longest match is unique, that concept
 * resolves; if two concepts tie at the same longest length, that is
 * `Certainty.AMBIGUOUS` by construction — see `matching.test.ts` for the
 * Hindi substring collision this exists to guard
 * (`देसवीं उत्तीर्ण वर्ष` containing `उत्तीर्ण वर्ष`) and the
 * `messy.html` `fld_7` case this produces on purpose (`"Year"` + "(of
 * joining current employer)" ties between the current employer and the
 * employer-start-year concepts — genuinely ambiguous, not a bug).
 */

import { Certainty } from "../agent/types";
import type { FormField } from "../form/types";
import { normaliseLabel } from "../ontology";
import type { Concept, ConceptIndex } from "../ontology/types";
import { type MatchCandidate, type MatchResult, MatchTier } from "./types";

const MIN_ALIAS_TOKENS_FOR_COVERAGE = 2;

const tokenize = (text: string): readonly string[] =>
  normaliseLabel(text).split(" ").filter(Boolean);

const lastAutocompleteToken = (autocomplete: string): string => {
  const parts = autocomplete.trim().toLowerCase().split(/\s+/);
  return parts[parts.length - 1] ?? "";
};

/** `FieldKind` values that line up 1:1 with `Concept.expects`. */
const KIND_EXPECTS = new Set<string>([
  "text",
  "email",
  "tel",
  "url",
  "number",
  "date",
  "select",
  "file",
]);

// --- Tier 1: autocomplete token -------------------------------------------

const matchAutocomplete = (
  field: FormField,
  concepts: readonly Concept[],
): MatchCandidate[] => {
  if (!field.autocomplete) return [];
  const token = lastAutocompleteToken(field.autocomplete);
  if (!token || token === "on" || token === "off") return [];

  const hits = concepts.filter((c) =>
    (c.autocomplete ?? []).some((t) => t.toLowerCase() === token),
  );
  return hits.map((c) => ({
    conceptKey: c.key,
    tier: MatchTier.AUTOCOMPLETE,
    score: 1,
  }));
};

// --- Tier 2: type + name/id heuristics -------------------------------------

/**
 * Only fires when the field's kind maps to an `expects` value that exactly
 * one concept in the whole ontology declares. `type=url` still narrows this
 * way. `type=tel` and `type=email` do *not* narrow — three concepts expect a
 * phone number, and `contact.email`/`contact.alternate_email` both expect
 * email — so this intentionally produces no candidate for either,
 * deferring to alias/nearby text tiers that can actually tell them apart.
 */
const matchTypeNarrowing = (
  field: FormField,
  concepts: readonly Concept[],
): MatchCandidate[] => {
  if (!KIND_EXPECTS.has(field.kind)) return [];
  const matching = concepts.filter((c) => c.expects === field.kind);
  if (matching.length !== 1) return [];

  const [only] = matching;
  if (!only) return [];
  return [{ conceptKey: only.key, tier: MatchTier.TYPE_NARROWING, score: 0.8 }];
};

// --- Tier 3: exact normalised alias ----------------------------------------

const matchAlias = (
  field: FormField,
  index: ConceptIndex,
): MatchCandidate[] => {
  if (!field.label) return [];
  const concept = index.byAlias(field.label);
  return concept
    ? [{ conceptKey: concept.key, tier: MatchTier.ALIAS, score: 0.95 }]
    : [];
};

// --- Tiers 4 and 5: containment ---------------------------------------------

interface CoverageMatch {
  readonly conceptKey: string;
  readonly length: number;
}

/**
 * The longest alias (across all locales) each concept matches by full
 * token coverage in `textTokens`, for concepts whose best alias clears
 * {@link MIN_ALIAS_TOKENS_FOR_COVERAGE}.
 */
const coverageMatches = (
  textTokens: ReadonlySet<string>,
  concepts: readonly Concept[],
): CoverageMatch[] => {
  const bestByConcept = new Map<string, number>();

  for (const concept of concepts) {
    for (const aliasList of Object.values(concept.aliases)) {
      for (const alias of aliasList) {
        const aliasTokens = tokenize(alias);
        if (aliasTokens.length < MIN_ALIAS_TOKENS_FOR_COVERAGE) continue;
        if (!aliasTokens.every((t) => textTokens.has(t))) continue;

        const best = bestByConcept.get(concept.key) ?? 0;
        if (aliasTokens.length > best) {
          bestByConcept.set(concept.key, aliasTokens.length);
        }
      }
    }
  }

  return Array.from(bestByConcept, ([conceptKey, length]) => ({
    conceptKey,
    length,
  }));
};

/** Longest-match-wins: only concepts tied for the longest coverage survive. */
const topCoverageCandidates = (
  matches: readonly CoverageMatch[],
  tier: MatchTier,
): MatchCandidate[] => {
  if (matches.length === 0) return [];

  const maxLength = Math.max(...matches.map((m) => m.length));
  const score = Math.min(0.9, 0.4 + maxLength * 0.15);

  return matches
    .filter((m) => m.length === maxLength)
    .map((m) => ({ conceptKey: m.conceptKey, tier, score }));
};

const matchPlaceholder = (
  field: FormField,
  concepts: readonly Concept[],
): MatchCandidate[] => {
  if (!field.placeholder) return [];
  const textTokens = new Set(tokenize(field.placeholder));
  return topCoverageCandidates(
    coverageMatches(textTokens, concepts),
    MatchTier.PLACEHOLDER,
  );
};

const matchNearbyText = (
  field: FormField,
  concepts: readonly Concept[],
): MatchCandidate[] => {
  const parts = [field.label, ...(field.nearbyText ?? [])].filter(
    (s): s is string => !!s,
  );
  if (parts.length === 0) return [];

  const textTokens = new Set(parts.flatMap(tokenize));
  return topCoverageCandidates(
    coverageMatches(textTokens, concepts),
    MatchTier.NEARBY_TEXT,
  );
};

// --- The cascade -------------------------------------------------------------

const TIERS: ((
  field: FormField,
  concepts: readonly Concept[],
  index: ConceptIndex,
) => MatchCandidate[])[] = [
  (field, concepts) => matchAutocomplete(field, concepts),
  (field, concepts) => matchTypeNarrowing(field, concepts),
  (field, _concepts, index) => matchAlias(field, index),
  (field, concepts) => matchPlaceholder(field, concepts),
  (field, concepts) => matchNearbyText(field, concepts),
];

export const resolve = (field: FormField, index: ConceptIndex): MatchResult => {
  const concepts = index.all;

  for (const tier of TIERS) {
    const candidates = tier(field, concepts, index);
    if (candidates.length === 0) continue;

    return {
      candidates,
      certainty:
        candidates.length === 1 ? Certainty.KNOWN : Certainty.AMBIGUOUS,
    };
  }

  return { candidates: [], certainty: Certainty.UNKNOWN };
};
