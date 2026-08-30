# Testing

```bash
bun test          # everything
bun test:watch    # iterate
bun check         # lint + typecheck + test, the full local gate
```

`bun:test` is the runner — it is what the repo and CI already use, so there is no
Vitest here.

## Why the tests are fast

`src/core` imports no React, no browser APIs and no network clients — enforced by
lint. So the domain layer runs in plain Bun with no DOM, no extension host and no
mocking of either. The whole suite is well under a second.

Keeping it that way is a design constraint, not a happy accident. If a domain
test starts needing a DOM, the logic is in the wrong layer.

## What to test where

| Layer | Runner | What |
|---|---|---|
| `src/core/**` | `bun test` | Ontology, matching, state transitions, tool schemas, policy, providers |
| Adapters (`src/lib`) | `bun test` with fakes | Storage, messaging, site access |
| End to end | Playwright, later | Real Chrome, real DOM, `test-site/` fixtures |

## The fixture site

```bash
bun dev:site   # http://localhost:4173
```

| Fixture | Exercises |
|---|---|
| `simple.html` | Well-formed: `<label for>` on every control, all common input types. Field detection should reach 100% here with no model. |
| `messy.html` | No labels at all. Opaque names (`fld_1`), placeholder-only fields, meaning in adjacent text, a bare "Year" that is genuinely ambiguous, a Hindi label, and an Aadhaar field that must never be auto-filled. |
| `dynamic.html` | Fields injected after load and between steps, plus page-level validation. Observation must be re-run rather than cached. |

Automated tests never depend on a third-party website. Real sites change without
warning, rate-limit, and make a red build mean nothing.

`messy.html` is the honest benchmark. `simple.html` will make almost any approach
look good.

## Conventions

Tests live in `src/core/tests/`, named after what they cover.

Test names state the behaviour and, where it is not obvious, the reason:

```ts
it("sends a failed verification back to PLAN, not to ACT", ...)
it("never automates final submission, however confident and confirmed", ...)
it("returns undefined rather than a best guess", ...)
```

A test that only restates the implementation ("calls the function") is not worth
the maintenance. A test that pins a decision is.

## Not yet built

**Playwright.** MV3 extension end-to-end testing needs persistent-context
plumbing and is worth doing — once there is a fill flow to exercise. The fixtures
exist now because they are needed for manual development anyway.

**An evaluation runner.** A JSON dataset of `label → expected concept key`
iterated by a normal test is the first version, and it arrives with the first
mapping implementation. Building a `datasets/ cases/ runner/ metrics/` framework
before there is a single mapping to measure would be scaffolding around an empty
room.
