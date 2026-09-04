# Phase 1a — The extractor, the FieldId scheme, and goldens

**Depends on:** Phase 0. **Unblocks:** 1b (needs goldens), 1c, 2, and ADR 007's `fieldKey`.

## Goal

Nothing in this repo produces a `FormIR`. Every downstream phase consumes one. Build the
DOM → `FormIR` extractor, decide how a field is identified, and freeze the output as committed
golden files so that matching accuracy can be measured against something stable.

Also: add the fixture that proves filling is hard. All three existing fixtures are vanilla
`<input>` elements, which makes writing values look solved. It is not.

## Required reading

- [`_context.md`](./_context.md) first.
- `src/core/form/types.ts` — the whole file. This is the contract you implement against.
- `docs/architecture.md` — the "Where the browser lives" section. The extractor is an
  **adapter**; it lives in `src/lib`, not `src/core`.
- `docs/agent.md` — "Progressive disclosure of context", which is why `FieldSummary` and
  `FormField` are separate types.
- `e2e/fixture-site.spec.ts` — how the fixtures are currently guarded.

## Inline context

The contract, so you do not have to hold the file open:

```ts
FieldKind = text | email | tel | url | number | date | textarea
          | select | radio | checkbox | file | password | hidden | unknown

FieldConstraint = { kind: "required" }
  | { kind: "minLength" | "maxLength" | "step", value: number }
  | { kind: "min" | "max", value: number | string }
  | { kind: "pattern", value: string }
  | { kind: "accept", value: readonly string[] }        // file inputs
  | { kind: "maxFileSizeBytes", value: number }

FieldSummary { id, kind, label?, required, hasValue }   // the cheap projection
FormField extends FieldSummary {
  name?, placeholder?, autocomplete?, description?,     // description ← aria-describedby
  nearbyText?, options?, constraints, disabled, readOnly
}
PageObservation { origin, path, title, forms: FormSummary[], observedAt }
```

**`hasValue` is the only thing that may report on content.** `FormIR` carries shape, not
content — if values rode along in every observation, personal data would end up in prompts by
default. This is not a style preference; deliverable 4 mechanises it.

**`origin` never carries a query string.** A query string can hold a session token or an email
address.

## Deliverables

### 1. The `FieldId` scheme

Nothing defines this today and it is load-bearing four times over: VERIFY refers to a field
after the DOM has changed; `dynamic.html` re-observation must produce the *same* id for a field
that persisted; the goldens and expectation files key off it; and ADR 007's `fieldKey` is
derived from it.

Constraints it must satisfy:

- **Non-personal.** `fieldId` is in the `LogFields` allowlist, so it will be logged. It cannot
  be the label, the placeholder, or anything the user typed.
- **Stable across re-observation** when the field itself persisted, including across
  `dynamic.html`'s step-2 transition, which injects siblings.
- **Stable across a page reload** of the same form.
- **Distinct** for two controls that differ only by position.

A shape like `formIndex/controlIndex/hash(name || id || null)` satisfies these. You choose;
record the choice and the reasoning in the handback, because changing it later invalidates
every golden and every expectation file.

**Tests:** yes, unit. Put any pure logic in `src/core/form/field-id.ts` so it is testable under
`bun test` with no DOM. **Why:** it is pure, it is load-bearing, and the stability property is
exactly the kind of thing that silently regresses.

### 2. The extractor

New: `src/lib/form/extract.ts`. DOM in, `PageObservation` out.

**Decide and record each of these:**

- **Radio and checkbox groups.** `simple.html` has `contact_pref` as two radios sharing a name.
  One `FormField` with `options`, or one per control? This changes every field count downstream.
- **Skip rules.** `type=hidden` (the `csrf` field in `simple.html`), `type=password`,
  `disabled`, `readOnly`, zero-size elements. These are **never candidates** — structurally
  excluded, not "unmatched". The distinction matters for the eval in 1b: an abstention on a
  field that was never a candidate should not be scored at all.
- **Label resolution order.** `<label for>` → wrapping `<label>` → `aria-label` →
  `aria-labelledby` → `<legend>` for grouped controls → preceding sibling text (this is what
  `messy.html` needs) → placeholder. Record the order; 1b's matching tiers depend on knowing
  which signal produced `label` versus what stays in `nearbyText`.
- **`nearbyText` scope.** How far do you look, and in which direction? `messy.html`'s `fld_7`
  has its disambiguator in a *trailing* sibling. Too greedy and every field inherits the page's
  boilerplate; too narrow and `fld_7` is unresolvable.

**Out of scope for v1 — write it down rather than half-supporting it:** iframes
(`registerContentScripts` defaults `allFrames: false`, and framed forms are the norm on
government and payment portals), shadow DOM, `contenteditable`, SPA route changes.

**Tests:** e2e goldens (deliverable 5), not unit tests. **Why:** this code's entire job is
reading a real DOM. A unit test against a synthetic DOM would test your mock, and `src/core`'s
no-DOM rule means it cannot live there anyway.

### 3. `test-site/controlled.html` — the hard-fill fixture

**This is the highest-value item in the phase.** Four controls, each defeating a naive write:

1. A **React-style controlled input** — an `input` event handler that resets `.value` unless
   the native setter is used (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set`)
   followed by a bubbling `input` event.
2. A **masked phone field** that reformats on input, so what you typed is not what is stored.
3. A **custom `div[role=combobox]`** with a listbox, which ignores `.value` entirely and only
   responds to clicks.
4. A **date input that rejects the wrong format**, silently keeping its previous value.

Add it to `e2e/fixture-site.spec.ts` alongside the others so it cannot be quietly tidied up.

**You are not building the fill logic in this phase** — Phase 2 does. You are building the
fixture and proving the extractor sees these controls correctly. But *do* spike the write
technique against it and record what worked, because if the setter+event approach cannot drive
the combobox, `AgentAction` may need a "click an option" member — and widening that union is a
security decision under `docs/agent.md`. Discovering that need now is worth far more than
discovering it in Phase 2.

**Tests:** yes, e2e — one spec asserting all four controls are extracted with the right
`FieldKind`, plus the fixture-shape guard. **Why:** a fixture that silently loses its
awkwardness makes every later number meaningless. `docs/testing.md` makes this argument.

### 4. The sentinel test — shape, not content

```ts
await page.getByLabel("Email address").fill("sentinel-abc-123@example.com");
const ir = await page.evaluate(() => extract());
expect(JSON.stringify(ir)).not.toContain("sentinel-abc-123");
expect(fieldById(ir, emailId).hasValue).toBe(true);
```

**Tests:** this is the test. **Why:** `docs/architecture.md` claims `FormIR` carries shape and
not content, and until this exists that claim is a comment. It is also the cheapest possible
guard against the most expensive class of bug in this product.

### 5. Goldens and `e2e/extraction.spec.ts`

Build the extractor as a standalone IIFE (`bun build --target=browser`) and inject it with
`page.addScriptTag()`. **No extension, no permissions, no manifest** — just DOM in, JSON out.
This keeps the highest-value test in the phase independent of every unsolved problem in site
access, which is not wired up until 1c.

```
for each of simple / messy / dynamic / controlled:
  page.goto(fixture) → addScriptTag → evaluate(extract())
  expect(result).toEqual(golden)
```

Commit the goldens under `e2e/goldens/`. Add `bun run goldens:update` to regenerate them so a
change arrives as a reviewable diff rather than a mystery.

Two more assertions in the same spec:

- **Id stability on `dynamic.html`:** capture ids before the step transition, advance, capture
  again, assert the earlier ids are all still present.
- **The 600 ms injected referral field** appears in a re-observation and not in the first one.

**Tests:** yes, e2e + committed goldens. **Why:** goldens are what make 1b's accuracy numbers
mean anything. Without them, a matcher regression and an extractor regression are
indistinguishable.

### 6. Performance budget

Generate a 500-field page in the spec (do not commit it as a fixture) and assert extraction
completes within a budget you choose and record. Also cap fields per page in the extractor
itself and record the cap.

**Tests:** yes, one e2e assertion. **Why:** "it slows down my browsing" is both a review risk
and a one-star review, and this is the only phase where the cost is one line.

## Gate

```bash
bun check
bun run build
bun test:e2e
```

All four goldens committed and matching. The sentinel test passing. The id-stability assertion
passing on `dynamic.html`. Report the extraction time for the 500-field page.

Then: change one thing in `simple.html` and confirm the golden diff is legible. Report that you
did this.

## Decisions to record in the handback

Phase 1b's brief cannot be finalised without all of these:

- The `FieldId` scheme, and why.
- Radio/checkbox grouping: one field or many.
- The full skip list, and the label-resolution order.
- `nearbyText` scope, and whether `fld_7`'s trailing disambiguator survives into the IR.
- Which write technique drove each of `controlled.html`'s four controls, and whether the
  combobox needed something `AgentAction` cannot currently express.
- The per-page field cap and the measured extraction time.

## Out of scope

No matching. No memory. No fill. No agent loop. No site-access wiring. You produce a `FormIR`
and prove it is correct and stable; that is the whole phase.

## Traps

- **Putting the extractor in `src/core`.** It reads the DOM. `bun lint` will stop you, but the
  temptation to "just put the pure part there" produces a module split along the wrong seam.
- **Letting a value into the IR** because verification will need it later. Verification reads
  values through its own authorised path in Phase 2. Deliverable 4 exists to catch this.
- **Making `FieldId` from the label** because it is convenient and readable. It is personal
  data and it is in the log allowlist.
- **Treating the `csrf` hidden field as an unmatched field.** It is not a candidate at all.
- **Tidying up `messy.html`.** Its awkwardness is the point.
