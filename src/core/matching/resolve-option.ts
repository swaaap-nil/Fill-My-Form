/**
 * Resolves a stored memory value against one field's enumerated options.
 *
 * `resolve.ts` answers "which concept is this field?"; this answers a
 * different question that only applies once a concept already has a stored
 * value AND the field is closed-vocabulary (`<select>`, radio/checkbox
 * groups, ARIA widgets with `options`): "which of the page's own options
 * does that stored value mean?" A page's option `value` attribute is
 * frequently an opaque code (`value="2"`) with the real meaning only in the
 * visible `label` ("OBC-NCL") — see `e2e/extraction.spec.ts`'s
 * "row-labelled Material-style controls" fixture — so a stored value is
 * matched against both `value` and `label`, never `value` alone.
 *
 * Same discipline as `resolve.ts`: cheapest and most precise tier first,
 * each tier either finds nothing (fall through), finds exactly one option
 * (`Certainty.KNOWN`), or finds two-or-more equally strong options
 * (`Certainty.AMBIGUOUS` — never guess between them).
 */

import { Certainty } from "../agent/types";
import type { FormOption } from "../form/types";
import { normaliseLabel } from "../ontology";
import type { Concept } from "../ontology/types";
import { ConfidenceLevel } from "../policy/types";

export const OptionMatchTier = {
  /** Normalised stored value equals a normalised option `value` or `label`. */
  EXACT: "exact",
  /** Stored value rewritten through the concept's `valueAliases` table, then exact. */
  VALUE_ALIAS: "value_alias",
  /** Every token of the stored value is a subset of one option's tokens. */
  CONTAINMENT: "containment",
} as const;

export type OptionMatchTier =
  (typeof OptionMatchTier)[keyof typeof OptionMatchTier];

export const OPTION_TIER_CONFIDENCE: Readonly<
  Record<OptionMatchTier, ConfidenceLevel>
> = {
  [OptionMatchTier.EXACT]: ConfidenceLevel.HIGH,
  [OptionMatchTier.VALUE_ALIAS]: ConfidenceLevel.HIGH,
  [OptionMatchTier.CONTAINMENT]: ConfidenceLevel.MEDIUM,
};

export type OptionMatchResult =
  | {
      readonly certainty: typeof Certainty.KNOWN;
      readonly option: FormOption;
      readonly tier: OptionMatchTier;
    }
  | {
      readonly certainty: typeof Certainty.AMBIGUOUS;
      readonly candidates: readonly FormOption[];
    }
  | { readonly certainty: typeof Certainty.UNKNOWN };

const tokenize = (text: string): readonly string[] =>
  normaliseLabel(text).split(" ").filter(Boolean);

const compact = (text: string): string =>
  normaliseLabel(text).replaceAll(" ", "");

const exactMatches = (
  normalisedValue: string,
  options: readonly FormOption[],
): FormOption[] => {
  const compactValue = compact(normalisedValue);
  return options.filter((o) => {
    const optionValue = normaliseLabel(o.value);
    const optionLabel = normaliseLabel(o.label);
    return (
      optionValue === normalisedValue ||
      optionLabel === normalisedValue ||
      compact(optionValue) === compactValue ||
      compact(optionLabel) === compactValue
    );
  });
};

const containmentMatches = (
  valueTokens: ReadonlySet<string>,
  options: readonly FormOption[],
): FormOption[] => {
  if (valueTokens.size === 0) return [];

  const scored = options
    .map((o) => {
      const optionTokens = new Set([
        ...tokenize(o.value),
        ...tokenize(o.label),
      ]);
      const covered = Array.from(valueTokens).every((t) => optionTokens.has(t));
      return covered ? { option: o, size: optionTokens.size } : null;
    })
    .filter((m): m is { option: FormOption; size: number } => m !== null);

  if (scored.length === 0) return [];

  // Most-specific (smallest) option wins on a tie for token coverage —
  // mirrors resolve.ts's "longest alias wins" but inverted: here a smaller
  // option that still contains every stored token is the tighter match.
  const minSize = Math.min(...scored.map((m) => m.size));
  return scored.filter((m) => m.size === minSize).map((m) => m.option);
};

const asKnown = (
  candidates: readonly FormOption[],
  tier: OptionMatchTier,
): OptionMatchResult | null => {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) {
    const [option] = candidates;
    if (!option) return null;
    return { certainty: Certainty.KNOWN, option, tier };
  }
  return { certainty: Certainty.AMBIGUOUS, candidates };
};

export const resolveOption = (
  rawValue: string,
  options: readonly FormOption[],
  concept?: Concept,
  locale?: string,
): OptionMatchResult => {
  if (options.length === 0) return { certainty: Certainty.UNKNOWN };

  const normalisedValue = normaliseLabel(rawValue);
  if (!normalisedValue) return { certainty: Certainty.UNKNOWN };

  const exact = asKnown(
    exactMatches(normalisedValue, options),
    OptionMatchTier.EXACT,
  );
  if (exact) return exact;

  const valueAliases = concept?.valueAliases;
  const alias =
    (locale && valueAliases?.[locale]?.[normalisedValue]) ??
    valueAliases?.en?.[normalisedValue];
  if (alias) {
    const aliased = asKnown(
      exactMatches(normaliseLabel(alias), options),
      OptionMatchTier.VALUE_ALIAS,
    );
    if (aliased) return aliased;
  }

  const containment = asKnown(
    containmentMatches(new Set(tokenize(rawValue)), options),
    OptionMatchTier.CONTAINMENT,
  );
  if (containment) return containment;

  return { certainty: Certainty.UNKNOWN };
};
