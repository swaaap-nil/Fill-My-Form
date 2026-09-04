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
| `src/core/ontology/` | **Works.** `createConceptIndex`, `normaliseLabel` (Devanagari-safe), exact/normalised `byAlias`. 16 concepts. |
| `src/core/tools/registry.ts` | **Works.** validate → policy → execute → validate, plus `describe(domains)`. |
| `src/core/llm/` | **Works.** `LLMProvider` port, `MockLLMProvider`, `AiSdkProvider`. |
| `src/core/policy/default.ts` | **Works.** Default-deny; submission denied unconditionally. |
| `src/core/logging.ts`, `errors.ts` | **Works.** `LogFields` is a closed allowlist with no index signature. |
| `src/lib/site-access.ts` | Written, **zero UI call sites**, no unit tests, imports `wxt/browser` at module scope. |
| `src/core/form/types.ts` | Types only. **Nothing produces a `FormIR`.** |
| `src/core/memory/` | Types + a 20-line `MemoryStore` interface. **No implementation.** |
| `src/core/agent/types.ts` | Types, `PHASE_TRANSITIONS`, `canTransition`. **No reducer, no loop.** |
| `src/core/verification/types.ts` | Types only. **No `Verifier`.** |
| `src/app/sidepanel`, `options` | Starter placeholders rendering "Hello from …". |
| `src/app/content/index.tsx` | Renders a badge. No DOM scanning, no fill, no messaging. |

52 unit tests (`bun test`, plain Bun, no DOM) and 10 Playwright e2e smoke tests pass today.

## Three defects to know about before you start

These were verified this session. Do not "discover" them again.

1. **`requestSiteAccess` has no callers.** Only `restoreGrantedSites` runs, from
   `src/app/background/index.ts`. The per-origin grant flow — the runtime half of the
   privacy design — is unreachable from the UI.
2. **No `restricted` concept exists** (12 `personal`, 4 `sensitive`, 0 `restricted`, 0
   `public`). So `defaultPolicy`'s RESTRICTED branch is dead code, `messy.html`'s Aadhaar
   field passes for the wrong reason, and — since nothing is `public` — **no field can
   auto-fill at all today**. Every fill needs confirmation.
3. **`registerContentScripts` does not affect the already-open tab.** After a grant the
   user sees nothing until reload. Needs a follow-up `scripting.executeScript`.

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

## Commands

```bash
bun check        # lint + typecheck + unit tests — the local gate
bun test         # unit tests only (bun test:watch to iterate)
bun test:e2e     # builds the extension, drives real Chromium
bun run build    # production build + zips, both browsers
bun dev          # Chrome with hot reload
bun dev:site     # fixtures at http://localhost:4173
```

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
