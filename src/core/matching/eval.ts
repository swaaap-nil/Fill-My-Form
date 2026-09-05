/**
 * The measurement, built before the thing it measures.
 *
 * `docs/memory.md`'s argument: build the deterministic tier, measure how
 * far it gets, and only then decide whether a model is worth adding — never
 * the other way around. This module is the "measure" half. It is pure and
 * DOM-free: it consumes a `FormField[]` (from a committed 1a golden) and a
 * hand-written expectation file, and produces the five-metric table the
 * phase 1b gate is judged against.
 */

import type { Certainty } from "../agent/types";
import type { FormField } from "../form/types";
import type { ConceptIndex } from "../ontology/types";
import { resolve } from "./resolve";

export const MetricBucket = {
  /** Matched, and matched right. */
  RESOLVED_CORRECT: "resolved_correct",
  /** Matched, and matched wrong. The one number that must stay at zero. */
  RESOLVED_WRONG: "resolved_wrong",
  /** Truth is `null` (no concept), and we abstained (unknown or ambiguous). */
  ABSTAINED_CORRECT: "abstained_correct",
  /** Truth is a concept, and we abstained (unknown or wrongly ambiguous). */
  MISSED: "missed",
  /** Truth is ambiguous, and we said ambiguous. */
  AMBIGUOUS_CORRECT: "ambiguous_correct",
} as const;

export type MetricBucket = (typeof MetricBucket)[keyof typeof MetricBucket];

export interface FieldExpectation {
  readonly fieldId: string;
  readonly expectedConcept: string | null;
  readonly expectedCertainty: Certainty;
}

export interface EvalOutcome {
  readonly fieldId: string;
  readonly expectation: FieldExpectation;
  readonly actualCertainty: Certainty;
  readonly actualConceptKey?: string;
  readonly bucket: MetricBucket;
}

/**
 * Classifies one field's outcome against its expectation. The only rule
 * that matters for the gate: a `KNOWN` result that names the wrong concept
 * is always `RESOLVED_WRONG`, regardless of what the expectation's
 * certainty was — a confident wrong answer is never anything else.
 */
export const classify = (
  expectation: FieldExpectation,
  actualCertainty: Certainty,
  actualConceptKey: string | undefined,
): MetricBucket => {
  if (actualCertainty === "known") {
    return actualConceptKey === expectation.expectedConcept
      ? MetricBucket.RESOLVED_CORRECT
      : MetricBucket.RESOLVED_WRONG;
  }

  if (actualCertainty === "ambiguous") {
    if (expectation.expectedCertainty === "ambiguous") {
      return MetricBucket.AMBIGUOUS_CORRECT;
    }
    return expectation.expectedConcept === null
      ? MetricBucket.ABSTAINED_CORRECT
      : MetricBucket.MISSED;
  }

  // actualCertainty === "unknown"
  return expectation.expectedConcept === null
    ? MetricBucket.ABSTAINED_CORRECT
    : MetricBucket.MISSED;
};

/**
 * Runs every expectation against the matcher. An expectation naming a
 * `fieldId` absent from `fields` throws rather than silently skipping —
 * 1a's skip rules already remove non-candidates from the golden itself, so
 * an expectation file should never name one; a mismatch here means the two
 * files have drifted apart.
 */
export const runEval = (
  fields: readonly FormField[],
  expectations: readonly FieldExpectation[],
  index: ConceptIndex,
): EvalOutcome[] => {
  const byId = new Map(fields.map((f) => [f.id, f]));

  return expectations.map((expectation) => {
    const field = byId.get(expectation.fieldId);
    if (!field) {
      throw new Error(
        `Expectation names fieldId "${expectation.fieldId}", which is not in the given fields. ` +
          "Either the golden regenerated with new ids, or this field was never a candidate.",
      );
    }

    const result = resolve(field, index);
    const actualConceptKey =
      result.certainty === "known"
        ? result.candidates[0]?.conceptKey
        : undefined;

    return {
      fieldId: expectation.fieldId,
      expectation,
      actualCertainty: result.certainty,
      actualConceptKey,
      bucket: classify(expectation, result.certainty, actualConceptKey),
    };
  });
};

export type MetricTable = Readonly<Record<MetricBucket, number>>;

export const computeMetrics = (
  outcomes: readonly EvalOutcome[],
): MetricTable => {
  const table: Record<MetricBucket, number> = {
    [MetricBucket.RESOLVED_CORRECT]: 0,
    [MetricBucket.RESOLVED_WRONG]: 0,
    [MetricBucket.ABSTAINED_CORRECT]: 0,
    [MetricBucket.MISSED]: 0,
    [MetricBucket.AMBIGUOUS_CORRECT]: 0,
  };

  for (const outcome of outcomes) {
    table[outcome.bucket] += 1;
  }

  return table;
};
