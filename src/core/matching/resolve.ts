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
  locale?: string,
): MatchCandidate[] => {
  if (!field.label) return [];
  const concept = index.byAlias(field.label, locale);
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
 * The longest alias each concept matches by full token coverage in
 * `textTokens`, for concepts whose best alias clears `minAliasTokens`
 * (default {@link MIN_ALIAS_TOKENS_FOR_COVERAGE}).
 *
 * When `locale` is given, a concept scopes to that locale's own alias list
 * — but only when the concept actually has aliases for that locale;
 * otherwise it falls back to scanning every locale. This keeps a declared
 * page locale from silently disabling matching for concepts that have not
 * yet had that locale's aliases added (most of them, for any locale beyond
 * `en`/`hi`), while still narrowing — and so avoiding cross-locale
 * collisions — for concepts that do have the locale populated.
 */
const coverageMatches = (
  textTokens: ReadonlySet<string>,
  concepts: readonly Concept[],
  locale?: string,
  minAliasTokens: number = MIN_ALIAS_TOKENS_FOR_COVERAGE,
): CoverageMatch[] => {
  const bestByConcept = new Map<string, number>();

  for (const concept of concepts) {
    const localeAliases = locale ? concept.aliases[locale] : undefined;
    const aliasLists = localeAliases
      ? [localeAliases]
      : Object.values(concept.aliases);

    for (const aliasList of aliasLists) {
      for (const alias of aliasList) {
        const aliasTokens = tokenize(alias);
        if (aliasTokens.length < minAliasTokens) continue;
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
  locale?: string,
): MatchCandidate[] => {
  if (!field.placeholder) return [];
  const textTokens = new Set(tokenize(field.placeholder));
  return topCoverageCandidates(
    coverageMatches(textTokens, concepts, locale),
    MatchTier.PLACEHOLDER,
  );
};

const matchNearbyText = (
  field: FormField,
  concepts: readonly Concept[],
  locale?: string,
): MatchCandidate[] => {
  const parts = [field.label, ...(field.nearbyText ?? [])].filter(
    (s): s is string => !!s,
  );
  if (parts.length === 0) return [];

  const textTokens = new Set(parts.flatMap(tokenize));
  return topCoverageCandidates(
    coverageMatches(textTokens, concepts, locale),
    MatchTier.NEARBY_TEXT,
  );
};

// --- The cascade -------------------------------------------------------------

const TIERS: ((
  field: FormField,
  concepts: readonly Concept[],
  index: ConceptIndex,
  locale?: string,
) => MatchCandidate[])[] = [
  (field, concepts) => matchAutocomplete(field, concepts),
  (field, concepts) => matchTypeNarrowing(field, concepts),
  (field, _concepts, index, locale) => matchAlias(field, index, locale),
  (field, concepts, _index, locale) =>
    matchPlaceholder(field, concepts, locale),
  (field, concepts, _index, locale) => matchNearbyText(field, concepts, locale),
];

export const resolve = (
  field: FormField,
  index: ConceptIndex,
  locale?: string,
): MatchResult => {
  const concepts = index.all;

  for (const tier of TIERS) {
    const candidates = tier(field, concepts, index, locale);
    if (candidates.length === 0) continue;

    return {
      candidates,
      certainty:
        candidates.length === 1 ? Certainty.KNOWN : Certainty.AMBIGUOUS,
    };
  }

  return { candidates: [], certainty: Certainty.UNKNOWN };
};

/**
 * Best single concept key for free text, by longest alias-token coverage
 * against a (typically small) concept subset — for callers that need
 * alias-driven text classification without building a `FormField` and
 * running the full tier cascade (e.g. `extract.ts`'s upload-kind
 * classifier). Returns `undefined` on no match or a genuine tie — this
 * never guesses, same discipline as `resolve()`.
 *
 * `minAliasTokens` defaults to {@link MIN_ALIAS_TOKENS_FOR_COVERAGE}, the
 * same guard tiers 4/5 use. Callers classifying against only a handful of
 * candidate concepts (rather than disambiguating among the whole ontology)
 * may want to lower it — a single-word alias is a weak signal when many
 * concepts compete for one field label, but a fine one when there are only
 * two or three possible answers.
 */
export const classifyByAliasCoverage = (
  text: string,
  concepts: readonly Concept[],
  locale?: string,
  minAliasTokens?: number,
): string | undefined => {
  const textTokens = new Set(tokenize(text));
  const matches = coverageMatches(textTokens, concepts, locale, minAliasTokens);
  if (matches.length === 0) return undefined;

  const maxLength = Math.max(...matches.map((m) => m.length));
  const top = matches.filter((m) => m.length === maxLength);
  return top.length === 1 ? top[0]?.conceptKey : undefined;
};
