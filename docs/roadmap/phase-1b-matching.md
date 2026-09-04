# Phase 1b — Measure first, then match

**Depends on:** 1a (needs committed goldens). **Unblocks:** 1c, and gates whether Phase 3 exists.

## Goal

Build the measurement before the thing being measured, then build the deterministic matching
tiers against it. Every tier that lands must move a number that already exists.

`docs/memory.md` states the reasoning: build the deterministic tier, measure how far it gets,
and add embeddings — or a model — only against a number. A matcher built before its eval is a
matcher nobody can improve safely.

## Required reading

- [`_context.md`](./_context.md) first.
- The 1a handback — the `FieldId` scheme, grouping, skip list and label-resolution order all
  change what you can match on.
- `src/core/ontology/types.ts` and `index.ts` — `createConceptIndex`, `normaliseLabel`, `byAlias`.
- `src/core/ontology/concepts.json` — all 16 concepts.
- `src/core/agent/types.ts` — the `Certainty` union.
- `src/core/policy/types.ts` — `ConfidenceLevel`, `PolicyRequest`.
- `docs/agent.md` — "Deterministic first" and "Never guess".

## Inline context

```ts
Certainty = known | unknown | ambiguous | requires_confirmation   // no fifth value
ConfidenceLevel = low | medium | high | certain
Concept = { key, label, sensitivity, volatility, expects, aliases: Record<lang, string[]> }
Sensitivity = public | personal | sensitive | restricted
```

`normaliseLabel` lowercases, collapses `_-/\` to spaces, strips punctuation, and **keeps
Unicode combining marks** (`\p{M}`) — without that, Devanagari matras are stripped and `दसवीं`
collapses to `दसव`. Do not "simplify" it.

**Current ontology reality:** 12 `personal`, 4 `sensitive`, **0 `restricted`, 0 `public`**.
Since `defaultPolicy` only auto-allows `public` + low risk, nothing can auto-fill today.

## Deliverables

### 1. The eval harness — build this first

`src/core/tests/fixtures/expectations/{simple,messy,dynamic,controlled}.json`, each entry:

```json
{ "fieldId": "…", "expectedConcept": "contact.email" | null, "expectedCertainty": "known" }
```

The runner is a plain `bun test` over the goldens committed in 1a — no DOM, satisfying the
core constraint. Expose `bun run eval` to print the table.

**Metrics, all five:**

| Metric | Meaning |
|---|---|
| `resolved_correct` | Matched, and matched right |
| `resolved_wrong` | Matched, and matched wrong |
| `abstained_correct` | Truth is `null`, and we abstained |
| `missed` | Truth is a concept, and we abstained |
| `ambiguous_correct` | Truth is ambiguous, and we said ambiguous |

Fields excluded by 1a's skip rules are **not scored at all** — they were never candidates.

**Hard gate, asserted in a test so CI enforces it: `resolved_wrong === 0`.** Coverage is the
number you improve over time. A wrong fill is the number that never rises above zero. A wrong
value on a visa application is not a slightly worse outcome than an abstention; it is a
different category of failure.

**Tests:** yes — the harness *is* a test, plus unit tests for the metric computation itself
(feed it synthetic results, assert each counter). **Why:** a scoring bug that inflates accuracy
would misdirect every later decision, including whether Phase 3 happens at all.

### 2. Fix the "100% on simple.html" claim

`docs/testing.md` says field detection "should reach 100% here with no model". That is not a
well-formed metric. `simple.html` has 15 controls; the ontology covers roughly 9 of them.
"Cover note", "Preferred contact method", "I accept the terms" and the `csrf` field have no
concept and **should** be abstained on. Without scoring abstention as correct, the number is
meaningless.

Rewrite the claim in terms of the five metrics above.

**Tests:** none. **Why:** it is a documentation fix.

### 3. The matcher

New: `src/core/matching/`. Pure, no DOM, `bun test`-able.

**Do not put this behind `ConceptIndex.byAlias`.** That function returns `Concept | undefined`
and structurally cannot express ambiguity. `docs/architecture.md` says "a matching tier: add
behind `ConceptIndex`; callers do not change" — **that guidance is wrong and you should correct
it in the same change.** The matcher returns a candidate set:

```ts
resolve(field: FormField, index: ConceptIndex): {
  candidates: { conceptKey: string; tier: MatchTier; score: number }[];
  certainty: Certainty;
}
```

`AMBIGUOUS` is "≥2 candidates above threshold with no meaningful separation". This is why the
API shape matters: `messy.html`'s `fld_7` — bare "Year", with "(of joining current employer)"
in a trailing sibling — returns `UNKNOWN` under today's API because no `"year"` alias exists.
The fixture was built to demand an answer the current signature cannot produce.

**Tier order, cheapest and most precise first:**

1. **Autocomplete token** — `autocomplete="given-name"` and friends. **This tier does not exist
   yet:** `concepts.json` has no autofill tokens, yet `simple.html` hands them over for free.
   Add an `autocomplete` array to the concept schema. Highest precision, zero cost, currently
   absent. Do this first.
2. **Input `type` + `name`/`id` heuristics** — `type=email` narrows hard.
3. **Exact normalised alias** — what `byAlias` already does.
4. **Placeholder** — `messy.html`'s `fld_8` has an empty label div and only
   `placeholder="Enter your PIN code"`.
5. **Nearby text / containment** — needed for the pseudo-label rows, and the dangerous one; see
   deliverable 5.

**Tests:** yes, unit, extensively. Table-driven per tier, plus the eval harness as the
integration measure. **Why:** this is pure domain logic with a large input space and it is the
component whose failure mode is "quietly fills the wrong thing".

### 4. Ontology growth

**Add a `restricted` concept for Aadhaar / national id.** Today `messy.html`'s `fld_11` is
untouched because it is `UNKNOWN` — identical to any unmapped field. The `RESTRICTED` branch of
`defaultPolicy` is never exercised by the fixture built to exercise it. This is exactly the
failure `docs/testing.md` warns about with the `frame-ancestors` story: a test that passes while
exercising the wrong condition is worse than no test, because it is believed.

**Grow 16 → 40–60 concepts.** Minimum: address line 1, state, country, gender,
`employment.current.start_year` (the true answer for `fld_7`), PAN, passport number. Every new
concept needs `sensitivity` **and** `volatility` — both required by the schema, and
`sensitivity` is the difference between a field filling automatically and one that asks.

**Tests:** yes — one asserting every concept has both `sensitivity` and `volatility` (the schema
enforces presence; assert the *values* are sane, e.g. nothing carrying a government id is below
`restricted`), and one asserting the restricted concept resolves on `fld_11` and is denied
automatic fill by `defaultPolicy`. **Why:** the second one converts a safety property currently
held by accident into one held by policy.

### 5. The Hindi substring collision — guard it before you build tier 5

`education.undergraduate.completion_year` carries the Hindi alias `उत्तीर्ण वर्ष`, which is a
**substring** of `education.secondary.completion_year`'s `दसवीं उत्तीर्ण वर्ष`.

Exact normalised matching is safe today. The moment a containment or token-overlap tier lands —
which the pseudo-label rows require — `fld_10` flips to the wrong concept. Longest-match-wins,
plus a regression test naming both concepts. The same shape exists in English between
"graduation year" and "10th passing year".

**Tests:** yes, unit, and write it *before* tier 5. **Why:** this is a known landmine with a
known trigger. A test written after the tier is a test written after the bug.

### 6. Tier → `ConfidenceLevel` mapping

`PolicyRequest` needs a `ConfidenceLevel`; `Certainty` has no number; nothing bridges them. One
table in `src/core/matching/`, with tests. An autocomplete-token match is not the same
confidence as a nearby-text guess, and policy is the consumer that cares.

**Tests:** yes, unit, table-driven. **Why:** this table decides what fills without asking. It is
a security-relevant mapping wearing the costume of a lookup.

## Gate

```bash
bun check
bun run eval        # prints the table for all four fixtures
```

- `resolved_wrong === 0` on every fixture, asserted in a test.
- `fld_7` → `AMBIGUOUS`. `fld_10` → `education.secondary.completion_year`, not undergraduate.
- `fld_11` → the restricted concept, and `defaultPolicy` returns `REQUIRE_CONFIRMATION` for it.
- `fld_8` → `contact.address.postal_code` via the placeholder tier.
- The `csrf` field and the terms checkbox are not scored (never candidates).
- **Publish the coverage numbers in the handback.** They are the baseline Phase 3 must beat,
  and the evidence for whether Phase 3 should happen at all.

## Decisions to record in the handback

- Coverage per fixture, all five metrics. This is the phase's primary output.
- The tier → `ConfidenceLevel` table.
- The final concept count and which concepts were added.
- The ambiguity threshold, and how "no meaningful separation" was defined.
- Your recommendation on Phase 3: is the residual worth a model? Suggested bar is >15% of
  in-scope fields left `UNKNOWN` or `AMBIGUOUS`, but you have the numbers and the orchestrator
  does not — argue for or against.

## Out of scope

No model. No memory. No fill. No UI. If a field cannot be resolved deterministically, the
correct output is `UNKNOWN` or `AMBIGUOUS` — that is a successful outcome of this phase, not a
gap to paper over.

## Traps

- **Building the matcher first and the harness after.** Then you cannot tell whether a change
  helped, and the first accuracy number you produce will be the one you defend rather than the
  one you improve.
- **Adding a fuzzy tier to lift coverage.** Fuzzy matching raises `resolved_wrong`, which is
  the one number that must stay at zero. If you want it, prove it against the harness.
- **Resolving `fld_7` to something.** It is genuinely ambiguous. `AMBIGUOUS` is the right
  answer and the fixture exists to demand it.
- **Making `byAlias` return a list** to avoid writing a new module. It has callers and a test;
  add the matcher alongside it and let it keep its narrow job.
- **Guessing `sensitivity` on new concepts.** Getting it wrong on a government id is the
  difference between asking and disclosing.
