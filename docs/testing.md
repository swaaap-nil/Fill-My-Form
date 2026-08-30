# Testing

```bash
bun test          # unit tests
bun test:watch    # iterate
bun check         # lint + typecheck + unit tests, the full local gate
bun test:e2e      # builds the extension, then drives a real browser
bun test:e2e:ui   # the same, in Playwright's inspector
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
| End to end | `bun test:e2e` | The built extension in real Chromium, plus the fixtures |

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

## End-to-end tests

`e2e/` holds ten smoke tests. They run headless in about twelve seconds and
guard one thing unit tests structurally cannot: that the **built artefact**
actually works. A manifest, a service worker and a bundled entrypoint are never
touched by `bun test`.

`e2e/fixtures.ts` loads the built extension via `launchPersistentContext` —
extensions cannot be loaded into Playwright's ordinary `browser` fixture — and
discovers Chrome's assigned extension id from the background service worker's
URL. `channel: "chromium"` selects the full browser; the headless *shell* does
not support extensions.

What they assert:

| Test | Guards against |
|---|---|
| Service worker boots | A build that produces output which does not load |
| Manifest grants no site access | The privacy claim silently regressing |
| CSP forbids eval and remote script | `unsafe-eval` creeping back in |
| Side panel / popup / options render | A broken entrypoint, and any console error |
| Boots with no configuration | Env vars becoming required again |
| Fixtures keep their shape | `messy.html` being "tidied up" into uselessness |

The manifest test is the valuable one. `docs/privacy.md` warns that removing the
`build:manifestGenerated` hook in `wxt.config.ts` silently restores all-sites
access; this test turns that warning into a build failure. It has been verified
to fail when the hook is removed — a guard nobody has watched fail is not a
guard.

### Deliberate limits

**The real side panel is not opened.** `chrome.sidePanel.open()` requires a user
gesture on the toolbar icon, which is browser chrome, and Playwright drives only
page content. The specs navigate to `chrome-extension://<id>/sidepanel.html`
instead: the same React tree, reached a different way.

**No pixel comparison.** `toHaveScreenshot` baselines generated on macOS fail
against Linux CI on font rendering alone, and the UI is still the starter's
placeholder. Screenshots and traces are captured on failure as artifacts, which
is what actually helps when something breaks. Revisit once there is a UI worth
pinning — and generate the baselines in a container when you do.

**Not part of `bun check`.** These launch a real browser and are an order of
magnitude slower than the unit tests. They run as a separate CI job so a lint
failure still surfaces in seconds.

## Not yet built

**An evaluation runner.** A JSON dataset of `label → expected concept key`
iterated by a normal test is the first version, and it arrives with the first
mapping implementation. Building a `datasets/ cases/ runner/ metrics/` framework
before there is a single mapping to measure would be scaffolding around an empty
room.
