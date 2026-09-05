/**
 * Prints the phase 1b coverage table for all four fixtures.
 *
 * The same harness (`~/core/matching/eval`) backs the `bun test` gate in
 * `src/core/tests/eval.test.ts`; this script is the human-readable view —
 * `bun run eval`. No DOM, no browser: it reads the goldens 1a committed.
 */
import controlledGolden from "../e2e/goldens/controlled.full.json";
import dynamicGolden from "../e2e/goldens/dynamic.full.json";
import messyGolden from "../e2e/goldens/messy.full.json";
import simpleGolden from "../e2e/goldens/simple.full.json";
import type { Form } from "../src/core/form/types";
import {
  computeMetrics,
  type FieldExpectation,
  MetricBucket,
  type MetricTable,
  runEval,
} from "../src/core/matching/eval";
import { ontology } from "../src/core/ontology";
import controlledExpectations from "../src/core/tests/fixtures/expectations/controlled.json";
import dynamicExpectations from "../src/core/tests/fixtures/expectations/dynamic.json";
import messyExpectations from "../src/core/tests/fixtures/expectations/messy.json";
import simpleExpectations from "../src/core/tests/fixtures/expectations/simple.json";

const FIXTURES: {
  name: string;
  forms: Form[];
  expectations: FieldExpectation[];
}[] = [
  {
    name: "simple",
    forms: simpleGolden as Form[],
    expectations: simpleExpectations as FieldExpectation[],
  },
  {
    name: "messy",
    forms: messyGolden as Form[],
    expectations: messyExpectations as FieldExpectation[],
  },
  {
    name: "dynamic",
    forms: dynamicGolden as Form[],
    expectations: dynamicExpectations as FieldExpectation[],
  },
  {
    name: "controlled",
    forms: controlledGolden as Form[],
    expectations: controlledExpectations as FieldExpectation[],
  },
];

const BUCKETS = Object.values(MetricBucket);
const COLUMNS = ["fixture", ...BUCKETS];
const widths = COLUMNS.map((c) => Math.max(c.length, 16));

const row = (cells: readonly string[]): string =>
  cells.map((cell, i) => cell.padEnd(widths[i] ?? 16)).join(" | ");

const zeroTable = (): Record<MetricBucket, number> =>
  Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<
    MetricBucket,
    number
  >;

const addInto = (
  totals: Record<MetricBucket, number>,
  metrics: MetricTable,
) => {
  for (const bucket of BUCKETS) totals[bucket] += metrics[bucket];
};

console.log(row(COLUMNS));
console.log("-".repeat(row(COLUMNS).length));

const totals = zeroTable();

for (const { name, forms, expectations } of FIXTURES) {
  const fields = forms.flatMap((f) => f.fields);
  const metrics = computeMetrics(runEval(fields, expectations, ontology));
  addInto(totals, metrics);
  console.log(row([name, ...BUCKETS.map((b) => String(metrics[b]))]));
}

console.log("-".repeat(row(COLUMNS).length));
console.log(row(["TOTAL", ...BUCKETS.map((b) => String(totals[b]))]));

const inScope = Object.values(totals).reduce((a, b) => a + b, 0);
const residual =
  totals[MetricBucket.MISSED] + totals[MetricBucket.AMBIGUOUS_CORRECT];
const residualPct =
  inScope > 0 ? ((residual / inScope) * 100).toFixed(1) : "0.0";

console.log(
  `\nresolved_wrong: ${totals[MetricBucket.RESOLVED_WRONG]} (must be 0)`,
);
console.log(
  `residual (missed + ambiguous) / in-scope: ${residual}/${inScope} = ${residualPct}%`,
);
