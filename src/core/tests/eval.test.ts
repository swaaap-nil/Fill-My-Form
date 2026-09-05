import { describe, expect, it } from "bun:test";
import controlledGolden from "../../../e2e/goldens/controlled.full.json";
import dynamicGolden from "../../../e2e/goldens/dynamic.full.json";
import messyGolden from "../../../e2e/goldens/messy.full.json";
import simpleGolden from "../../../e2e/goldens/simple.full.json";
import type { Form } from "../form/types";
import { createFieldJournal } from "../journal/store";
import type { UnresolvedCertainty } from "../journal/types";
import {
  computeMetrics,
  type FieldExpectation,
  MetricBucket,
  runEval,
} from "../matching/eval";
import { resolve } from "../matching/resolve";
import { MatchTier } from "../matching/types";
import { ontology } from "../ontology";
import controlledExpectations from "./fixtures/expectations/controlled.json";
import dynamicExpectations from "./fixtures/expectations/dynamic.json";
import messyExpectations from "./fixtures/expectations/messy.json";
import simpleExpectations from "./fixtures/expectations/simple.json";

/**
 * The eval harness, run over 1a's committed goldens.
 *
 * This is deliberately a `bun test` over static JSON — no DOM, no browser —
 * per `docs/testing.md`'s rule that a domain test needing a DOM means the
 * logic is in the wrong layer. `bun run eval` (`scripts/eval.ts`) runs the
 * same harness and prints the full table for a human; this file is the
 * gate CI enforces.
 */

const FIXTURES: Record<
  string,
  { forms: Form[]; expectations: FieldExpectation[] }
> = {
  simple: {
    forms: simpleGolden as Form[],
    expectations: simpleExpectations as FieldExpectation[],
  },
  messy: {
    forms: messyGolden as Form[],
    expectations: messyExpectations as FieldExpectation[],
  },
  dynamic: {
    forms: dynamicGolden as Form[],
    expectations: dynamicExpectations as FieldExpectation[],
  },
  controlled: {
    forms: controlledGolden as Form[],
    expectations: controlledExpectations as FieldExpectation[],
  },
};

const fieldsOf = (forms: Form[]) => forms.flatMap((f) => f.fields);

describe("eval gate: resolved_wrong must be zero on every fixture", () => {
  for (const [name, { forms, expectations }] of Object.entries(FIXTURES)) {
    it(`${name}.html`, () => {
      const outcomes = runEval(fieldsOf(forms), expectations, ontology);
      const metrics = computeMetrics(outcomes);

      if (metrics[MetricBucket.RESOLVED_WRONG] > 0) {
        const wrong = outcomes.filter(
          (o) => o.bucket === MetricBucket.RESOLVED_WRONG,
        );
        throw new Error(
          `${name}.html has ${wrong.length} wrong resolution(s): ` +
            wrong
              .map(
                (o) =>
                  `${o.fieldId} -> ${o.actualConceptKey} (expected ${o.expectation.expectedConcept})`,
              )
              .join(", "),
        );
      }

      expect(metrics[MetricBucket.RESOLVED_WRONG]).toBe(0);
    });
  }
});

describe("specific gate assertions from the phase 1b brief", () => {
  it("messy.html's fld_7 (bare Year) resolves to AMBIGUOUS, not a guess", () => {
    const outcomes = runEval(
      fieldsOf(messyGolden as Form[]),
      messyExpectations as FieldExpectation[],
      ontology,
    );
    const fld7 = outcomes.find((o) => o.fieldId === "0/a29309c7/0");
    expect(fld7?.actualCertainty).toBe("ambiguous");
    expect(fld7?.bucket).toBe(MetricBucket.AMBIGUOUS_CORRECT);
  });

  it("messy.html's fld_10 (Hindi) resolves to secondary, not undergraduate completion year", () => {
    const outcomes = runEval(
      fieldsOf(messyGolden as Form[]),
      messyExpectations as FieldExpectation[],
      ontology,
    );
    const fld10 = outcomes.find((o) => o.fieldId === "0/58735643/0");
    expect(fld10?.actualConceptKey).toBe("education.secondary.completion_year");
  });

  it("messy.html's fld_11 (Aadhaar) resolves to the restricted national-id concept", () => {
    const outcomes = runEval(
      fieldsOf(messyGolden as Form[]),
      messyExpectations as FieldExpectation[],
      ontology,
    );
    const fld11 = outcomes.find((o) => o.fieldId === "0/577354b0/0");
    expect(fld11?.actualConceptKey).toBe("documents.national_id");
    expect(ontology.byKey("documents.national_id")?.sensitivity).toBe(
      "restricted",
    );
  });

  it("messy.html's fld_8 (placeholder-only) resolves via the placeholder tier", () => {
    const field = fieldsOf(messyGolden as Form[]).find(
      (f) => f.id === "0/9792f876/0",
    );
    expect(field).toBeDefined();
    if (!field) throw new Error("unreachable");

    const outcomes = runEval(
      [field],
      [
        {
          fieldId: field.id,
          expectedConcept: "contact.address.postal_code",
          expectedCertainty: "known",
        },
      ],
      ontology,
    );

    expect(outcomes[0]?.actualConceptKey).toBe("contact.address.postal_code");

    const result = resolve(field, ontology);
    expect(result.candidates[0]?.tier).toBe(MatchTier.PLACEHOLDER);
  });

  it("the csrf hidden field is never a candidate, so it is not in the golden to score; the terms checkbox is a candidate and abstains", () => {
    // 1a's extractor excludes type=hidden structurally, so simple.html's
    // golden has no field named "csrf" at all — there is nothing here for
    // an expectation file to even name. The terms checkbox IS a candidate
    // (checkboxes are never skipped) and is expected to abstain.
    const fields = fieldsOf(simpleGolden as Form[]);
    expect(fields.some((f) => f.name === "csrf")).toBe(false);
    expect(fields.length).toBe(
      (simpleExpectations as FieldExpectation[]).length,
    );

    const outcomes = runEval(
      fieldsOf(simpleGolden as Form[]),
      simpleExpectations as FieldExpectation[],
      ontology,
    );
    const terms = outcomes.find((o) => o.fieldId === "0/ee7a3c2c/0");
    expect(terms?.expectation.expectedConcept).toBeNull();
    expect(terms?.bucket).toBe(MetricBucket.ABSTAINED_CORRECT);
  });
});

describe("computeMetrics (synthetic outcomes, no DOM, no ontology)", () => {
  it("counts every bucket independently", () => {
    const outcomes = [
      {
        fieldId: "1",
        expectation: {
          fieldId: "1",
          expectedConcept: "a",
          expectedCertainty: "known" as const,
        },
        actualCertainty: "known" as const,
        actualConceptKey: "a",
        bucket: MetricBucket.RESOLVED_CORRECT,
      },
      {
        fieldId: "2",
        expectation: {
          fieldId: "2",
          expectedConcept: "a",
          expectedCertainty: "known" as const,
        },
        actualCertainty: "known" as const,
        actualConceptKey: "b",
        bucket: MetricBucket.RESOLVED_WRONG,
      },
      {
        fieldId: "3",
        expectation: {
          fieldId: "3",
          expectedConcept: null,
          expectedCertainty: "unknown" as const,
        },
        actualCertainty: "unknown" as const,
        bucket: MetricBucket.ABSTAINED_CORRECT,
      },
      {
        fieldId: "4",
        expectation: {
          fieldId: "4",
          expectedConcept: "a",
          expectedCertainty: "known" as const,
        },
        actualCertainty: "unknown" as const,
        bucket: MetricBucket.MISSED,
      },
      {
        fieldId: "5",
        expectation: {
          fieldId: "5",
          expectedConcept: null,
          expectedCertainty: "ambiguous" as const,
        },
        actualCertainty: "ambiguous" as const,
        bucket: MetricBucket.AMBIGUOUS_CORRECT,
      },
    ];

    expect(computeMetrics(outcomes)).toEqual({
      [MetricBucket.RESOLVED_CORRECT]: 1,
      [MetricBucket.RESOLVED_WRONG]: 1,
      [MetricBucket.ABSTAINED_CORRECT]: 1,
      [MetricBucket.MISSED]: 1,
      [MetricBucket.AMBIGUOUS_CORRECT]: 1,
    });
  });

  it("returns all zeros for no outcomes", () => {
    expect(computeMetrics([])).toEqual({
      [MetricBucket.RESOLVED_CORRECT]: 0,
      [MetricBucket.RESOLVED_WRONG]: 0,
      [MetricBucket.ABSTAINED_CORRECT]: 0,
      [MetricBucket.MISSED]: 0,
      [MetricBucket.AMBIGUOUS_CORRECT]: 0,
    });
  });
});

describe("the field journal, wired to real fixture output", () => {
  it("records every field the matcher did not resolve, across all four fixtures", () => {
    const journal = createFieldJournal();

    for (const forms of [
      simpleGolden,
      messyGolden,
      dynamicGolden,
      controlledGolden,
    ] as Form[][]) {
      for (const field of fieldsOf(forms)) {
        const result = resolve(field, ontology);
        if (
          result.certainty !== "unknown" &&
          result.certainty !== "ambiguous"
        ) {
          continue;
        }
        journal.record(
          {
            origin: "https://forms.example.com",
            fieldKey: field.id,
            label: [field.label, ...(field.nearbyText ?? [])]
              .filter(Boolean)
              .join(" "),
            kind: field.kind,
            autocomplete: field.autocomplete,
            tiersTried: result.candidates.map((c) => c.tier),
            certainty: result.certainty as UnresolvedCertainty,
            now: "2026-01-01T00:00:00.000Z",
          },
          [],
        );
      }
    }

    // simple.html: Cover note, Preferred contact method, terms checkbox.
    // messy.html: fld_7 (ambiguous).
    expect(journal.all().length).toBe(4);
    expect(
      journal.all().find((e) => e.normalisedLabel.startsWith("year"))
        ?.certainty,
    ).toBe("ambiguous");
  });
});
