# Shared context — read this before any phase brief

Every phase agent reads this file first, then its own brief. This file is the
standing briefing; the brief is the job.

## The product

A privacy-first browser extension (WXT, MV3, Chrome + Firefox) that fills web
forms from a personal memory held on the user's device. It resolves fields
deterministically — autocomplete tokens, then aliases — and reaches for a model
only for what those tiers cannot answer. When it does not know, it asks; it
never invents a value.

## Where the code actually is

Do not trust the README's module table to mean "implemented". It describes
contracts, most of which have no implementation.

| Module | State |
|---|---|
| `src/core/ontology/` | **Works.** `createConceptIndex`, `normaliseLabel` (Devanagari-safe), exact/normalised `byAlias`. 50 concepts, with `autocomplete` tokens (Phase 1b). |
| `src/lib/form/extract.ts` | **Works (Phase 1a).** DOM → `FormIR`. Four fixtures golden-tested, including the hard-fill `controlled.html`. |
| `src/core/matching/` | **Works (Phase 1b).** `resolve()` returns a candidate set across 5 tiers; `eval.ts` is the harness, `bun run eval` prints coverage. `resolved_wrong: 0` across all four fixtures. |
| `src/core/journal/` | **Works (Phase 1b), in-memory only.** Records fields the matcher could not resolve, screened against memory at write time. No IndexedDB backend yet, no panel UI. |
| `src/core/tools/registry.ts` | **Works.** validate → policy → execute → validate, plus `describe(domains)`. |
| `src/core/llm/` | **Works.** `LLMProvider` port, `MockLLMProvider`, `AiSdkProvider`. |
| `src/core/policy/default.ts` | **Works.** Default-deny; submission denied unconditionally. |
| `src/core/logging.ts`, `errors.ts` | **Works.** `LogFields` is a closed allowlist with no index signature. |
| `src/lib/site-access.ts` | **Works (Phase 1c).** DI'd (`createSiteAccess(browser)`), unit-tested against a fake, reachable from the side panel's "Grant access" button. Covers spike 2's open-tab injection gap via a direct `executeScript`. |
| `src/core/memory/` | **Works (Phase 1c).** `in-memory.ts` and IndexedDB implement the real interface (profile-qualified keys, `schemaVersion`), `write-service.ts` owns user-answer writes, imports restore validated local exports, `tools.ts` exposes two read-only tools. Lives in the background worker. |
| `src/core/fill/`, `src/core/messaging/` | **Works (Phase 1c).** `planFill`/`confirmDecision` (straight-line flow), tab-bound pending decisions in the background, and DOM-write payload validation in the content script. |
| `src/core/agent/types.ts` | Types, `PHASE_TRANSITIONS`, `canTransition`. **No reducer, no loop.** |
| `src/core/verification/types.ts` | Types only. **No `Verifier`.** |
| `src/app/sidepanel`, `options` | **Sidepanel works (Phase 1c):** onboarding form (ontology-driven) and the fill panel (grant/scan/confirm), stacked behind two toggle buttons — no tab primitive exists yet. `options` still renders `<Layout />` only. |
| `src/app/content/index.tsx` | **Works (Phase 1c).** `extractFullForm` and `fillField` message handlers, on top of the existing badge UI. Fill technique: native-setter + event, for text-like inputs/textarea/select/native radio/checkbox groups (`~/core/matching/resolve-option` resolves a stored value to the field's own option first). ARIA widgets whose options only exist in the DOM after an interaction (`controlled.html`'s combobox) are still not filled (Phase 2). |
| `src/components/ui/` | shadcn-style primitives (button, card, input, form, …). Compose from these. No select/radio/checkbox/tabs primitive yet — onboarding and the fill panel work around this (see the phase 1c handback). |
| `scripts/check-release-manifest.ts` | **Works,** wired into CI, with its own tests. Phase 0 built it. |

52 unit tests (`bun test`, plain Bun, no DOM) and 10 Playwright e2e smoke tests pass today.

## Three Phase 0 defects — resolved in Phase 1c

Verified in Phase 0, fixed in Phase 1c. Recorded so nobody "discovers" them again, and so
the fix is understood rather than just present.

1. ~~`requestSiteAccess` has no callers.~~ **Fixed.** The side panel's "Grant access to
   this site" button calls it. One wrinkle worth knowing: `chrome.permissions.request()`
   only succeeds inside the synchronous call stack of a user gesture, so this call had to
   live in the side panel itself, not be proxied through a `sendMessage` to the
   background — a background handler invoked via messaging does not inherit the gesture,
   and the call rejects with "This function must be called during a user gesture".
   `runFill`/`confirmFill` stay background messages (they need no gesture); only the
   `permissions.request()` path moved.
2. **No `restricted` concept exists** — fixed in Phase 1b (`documents.national_id` and
   others). Before that, `defaultPolicy`'s RESTRICTED branch was dead code and
   `messy.html`'s Aadhaar field passed for the wrong reason. Since nothing is `public`,
   **no field auto-fills today** — every fill still needs confirmation, which is correct
   behaviour, not a residual bug.
3. ~~`registerContentScripts` does not affect the already-open tab.~~ **Fixed.**
   `requestSiteAccess` now also calls `scripting.executeScript` into the active tab
   immediately after a successful grant. Registration covers future navigations; the
   direct injection covers the tab open right now.

Phase 0 is complete. Its spike answers — including confirmation that
`permissions.request()` works from the side panel — are in
[`docs/spikes-phase-0.md`](../spikes-phase-0.md). Read it if your phase touches site access.

## Non-negotiables

These are decisions, not preferences. If your brief seems to require breaking one, stop
and escalate — see the last section.

| Rule | Source |
|---|---|
| `src/core/**` imports no React, no `#imports`, no Supabase, no OpenPanel, no model SDK. Enforced by `noRestrictedImports` in `biome.json` — violations fail `bun lint` and CI. | [architecture.md](../architecture.md) |
| Everything in `src/core` is JSON-serialisable and runs under plain `bun test` with no DOM. A domain test that needs a DOM means the logic is in the wrong layer. | [testing.md](../testing.md) |
| The reducer and loop are hand-written. No LangGraph, no agent framework, no XState. | [ADR 004](../adr/004-hand-rolled-state-machine.md) |
| Nothing reads the **content** of a user's file. No OCR, no vision, on-device or otherwise. Pixel-level compliance work (crop, recompress) is allowed. | [ADR 005](../adr/005-no-document-content-reading.md) |
| Values carry `expiresAt`; expiry downgrades confidence into confirmation, never deletes. Freshness is a pure function of `(item, injected now)`, evaluated on read. No background sweep, no `alarms` permission. | [ADR 006](../adr/006-value-freshness-and-expiry.md) |
| Anything sent up is built from a closed schema, carries no account identifier, and never shares a transport with the billing channel. | [ADR 007](../adr/007-shared-site-knowledge.md) |
| `AgentAction` has exactly four members: `call_tool`, `ask_user`, `request_review`, `finish`. Widening this union is a security decision, not a feature decision. | [agent.md](../agent.md) |
| There is no `set_memory` tool and there will not be one. Writes go: `ask_user` answer → panel → application service → `MemoryStore`. Never through `executeTool`. | [memory.md](../memory.md) |
| Final form submission is never automated. Not gated on confidence, not configurable. | [privacy.md](../privacy.md) |
| `FormIR` carries shape, not content. `hasValue` is the only signal about what a field currently holds. | `src/core/form/types.ts` |
| Never log a value. `LogFields` has no index signature, so this is a type error — keep it that way. | `src/core/logging.ts` |

## Decisions already made (do not reopen)

- **v1 is local-only and free.** The auth UI is deleted; `src/lib/supabase.ts` stays in the
  tree but dormant and unreachable.
- **Firefox targets MV3**, not MV2. MV2 emits no `optional_permissions`, which makes the
  grant design inert there.
- **No at-rest encryption.** IndexedDB stores plaintext; `docs/privacy.md` states that
  at-rest protection is the operating system's job. Do not add a passphrase flow.
- **UI copy goes through `browser.i18n`** from Phase 0. The product targets forms worldwide.
- **Analytics is collected locally in v1 and transmitted only after Phase 8.** From Phase 1b,
  fields the matcher could not resolve are recorded to a local journal — nothing leaves the
  device, no consent is needed, no backend exists. The consent prompt and the upload channel
  arrive with the cloud layer. This keeps v1's store disclosure at "does not collect or
  transmit user data" while the corpus and the screening logic are built and proven early.
- **An admin panel must be connectable later, and the seam is the config document** — one
  versioned, schema-validated, remotely-supplied file that already exists in ADR 006 form.
  Do not invent a second channel, and do not let anything about an individual user flow up.

## Building UI

**There is no design yet, and you are not inventing one.** Build every surface so it can be
replaced wholesale later without touching logic. Optimise for replaceability, not for looks.

**Nothing about a UI element is hardcoded.** No hex colours, no pixel values, no magic spacing,
no inline styles in a feature component. Sizing, colour and spacing come from Tailwind tokens
and the CSS variables in `src/assets/styles/globals.css`. If the token you need does not exist,
add it there — never inline the value at the call site. A redesign should be a change to tokens
and primitives, not a search across every component.

**Compose from `src/components/ui/`.** Those primitives (button, card, input, form, label,
separator, and the rest) are the vocabulary. If a feature needs something they do not offer, add
a primitive there rather than styling ad hoc in the feature component.

**Icons come from `lucide-react`**, which is already a dependency. Pick the closest generic icon
and move on. Never hand-author an SVG in a feature component, and never use an emoji as an icon.
If nothing fits, use a clearly marked placeholder.

**Placeholders are correct, not lazy.** A marked placeholder beats an invented design, because
the invented one gets mistaken for a decision. Mark them so they are greppable when design
lands:

```tsx
{/* TODO(design): placeholder — see docs/roadmap/_context.md */}
```

**Keep presentation dumb.** Behaviour lives in hooks and services; components render what they
are given. A designer replacing the presentation layer must not have to understand the agent,
the policy engine or the memory store to do it.

**All user-visible strings go through `browser.i18n`** — decided in Phase 0, and the same
principle: no hardcoded content in components.

## Commands

```bash
bun check        # lint + typecheck + unit tests — the local gate
bun test         # unit tests only (bun test:watch to iterate)
bun test:e2e     # builds the extension, drives real Chromium
bun run build    # production build + zips, both browsers
bun dev          # Chrome with hot reload
bun dev:site     # fixtures at http://localhost:4173
```

## Clean means no warnings either

**A phase is not done while anything it touches emits a warning.** Errors are obvious; warnings
are the ones that accumulate until nobody reads the output, and then a real one hides in the
noise. That applies to all of it: Biome `info`/`warn` lines, TypeScript diagnostics, Vite and
WXT build warnings, deprecation notices, and browser console warnings in e2e — not only console
errors.

**Never silence a warning to make it go away.** No `biome-ignore`, no `@ts-expect-error`, no
`@ts-ignore`, no widening a type to `any`, no filtering the console in a test. Suppression turns
a visible problem into an invisible one.

**If you cannot legitimately fix it, stop and ask the user.** Report it under escalations with
the exact output, what you tried, and why the fix is not yours to make — a third-party
deprecation, an upstream bug, a dependency you were told not to touch. Asking is the expected
outcome for those; suppressing is not.

**`bun check` is currently silent** — lint, typecheck and tests emit nothing. Any warning you
see there is one you introduced. Keep it that way; the value of this rule comes entirely from
the output staying empty.

**`bun run build` is not silent**, and the exception is recorded here rather than suppressed,
which is what the rule above asks of you:

- `` `esbuild` option was specified by "vite:react-babel" plugin … use `oxc` instead ``
- `` `optimizeDeps.rollupOptions` … is deprecated. Use `optimizeDeps.rolldownOptions` ``
- `` `[vite:react-babel] We recommend switching to @vitejs/plugin-react-oxc` ``

These come from `@vitejs/plugin-react` inside WXT's Vite pipeline (`@wxt-dev/module-react`
1.1.3; Vite is transitive via `wxt`). Our own config sets `optimizeDeps.entries` and never
touches `esbuild`, so neither is ours to fix without upgrading or patching upstream. Treat these
three lines as the known baseline: if `bun run build` grows a *fourth* warning, it is yours.

## Testing policy

**Your brief tells you what to test.** Each deliverable in a phase brief carries an explicit
testing decision — unit, e2e, golden, or none — and the reasoning. Do not invent your own
test strategy, and do not skip a test the brief asks for because it seems obvious.

If you believe a deliverable needs a test the brief does not ask for, add it and say so in
your handback. If the brief asks for a test you believe is worthless, write it anyway and
argue in the handback. The brief is wrong sometimes; silently diverging from it is worse.

Conventions that hold everywhere:

- Domain tests live in `src/core/tests/`, named for what they cover.
- A test name states the behaviour, and the reason when it is not obvious:
  `it("sends a failed verification back to PLAN, not to ACT")`.
- A test that restates the implementation ("calls the function") is not worth maintaining.
  A test that pins a decision is.
- Never write a test that depends on a third-party website. `test-site/` exists for this.
- e2e specs go in `e2e/`. They are not part of `bun check` — they run as a separate CI job.

## The fixtures

`bun dev:site` serves `test-site/` at `:4173`.

| Fixture | What it is for |
|---|---|
| `simple.html` | 15 labelled controls with `autocomplete` attributes. The easy case. Includes a `csrf` hidden field that must be ignored. |
| `messy.html` | 11 fields, `fld_1`–`fld_11`, zero `<label>` elements. The honest benchmark. Contains the ambiguous bare "Year" (`fld_7`), a placeholder-only field (`fld_8`), opaque select values (`fld_9`), a Hindi label (`fld_10`), and Aadhaar (`fld_11`). |
| `dynamic.html` | 1 field served, 1 injected at 600 ms, 3 more after a step transition. Observation must be re-run, not cached. |
| `controlled.html` | **Added in Phase 1a.** React-controlled input, masked field, custom combobox. The hard-fill case. |

Fixtures are guarded by `e2e/fixture-site.spec.ts` — "tidying up" `messy.html` by adding
labels would silently make every accuracy number meaningless. Do not edit fixtures unless
your brief says to.

## Working conventions

- Conventional commits (`commitlint` enforces the type and subject; body lines warn over 100 chars).
- The pre-commit hook runs `bun lint:fix` and `bun typecheck` only. Tests are CI's job.
- Adapters (anything touching the DOM, storage or the network) live in `src/lib` or an
  entrypoint, never in `src/core`.
- Prefer deleting code over commenting it out.

## When to stop and escalate

Escalate to the orchestrator rather than deciding, if:

- Following the brief would break a non-negotiable above.
- The brief contradicts an ADR, or two ADRs contradict each other.
- A gate cannot pass for a reason the brief did not anticipate.
- You need to widen `AgentAction`, add a permission to the manifest, or add a dependency
  that touches `src/core`.
- You find a defect outside your phase's scope. Report it; do not fix it silently.

Escalating is cheap. A phase that quietly redefines its own gate is expensive.
