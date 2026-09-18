# `matching/` — `FormField` -> candidate concepts

Deterministic only. No model, no memory, no fill — see phase 1b's brief for why
that ordering matters: measure the deterministic tier before spending anything
on a model against it.

`resolve(field, index)` runs five tiers, cheapest and most precise first —
autocomplete token, type narrowing, exact alias, placeholder containment,
nearby-text containment — and returns a candidate set, not a single optional
value:

```ts
resolve(field: FormField, index: ConceptIndex): {
  candidates: { conceptKey: string; tier: MatchTier; score: number }[];
  certainty: Certainty;
}
```

Two or more candidates tied for the strongest match is `Certainty.AMBIGUOUS`,
not a guess. `docs/architecture.md` used to say a matching tier could sit
behind `ConceptIndex.byAlias`; that guidance was wrong — `byAlias` cannot
represent a tie — and has been corrected.

## The measurement lives here too

`eval.ts` is the harness: `runEval` scores a `FormField[]` against a
hand-written expectation file across five outcomes (`resolved_correct`,
`resolved_wrong`, `abstained_correct`, `missed`, `ambiguous_correct`).
`resolved_wrong` is the one number gated at zero — a wrong fill is not a
slightly worse outcome than an abstention. `bun run eval` prints the table;
`src/core/tests/eval.test.ts` is the CI gate.

`confidence.ts` bridges `MatchTier` to `~/core/policy`'s `ConfidenceLevel` —
security-relevant, not cosmetic, since policy decides what fills without
asking from this table.

## `resolve-option.ts` answers a different question

`resolve(field, index)` above is "which concept is this field?" —
`resolveOption(value, options, concept)` is "which of *this field's own*
options does a stored value mean?", relevant only once a concept already
resolved and the field is closed-vocabulary (`<select>`, radio/checkbox
groups). Same discipline, its own three tiers (exact, curated
`valueAliases`, token containment) and its own tie-is-ambiguous rule — see
`~/core/fill/driver` for where it's called and `~/core/fill/README.md` for
what happens to an ambiguous or unmatched result.

## What lands here next

A memory-retrieval tier behind the same candidate-set shape, and — only if
the residual after this phase's numbers justifies it — a model tier for what
the deterministic tiers leave `unknown` or `ambiguous`.
