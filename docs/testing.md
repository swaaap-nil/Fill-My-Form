# Testing

```bash
bun test          # unit tests
bun test:watch    # iterate
bun check         # lint + typecheck + unit tests, the full local gate
bun test:e2e        # builds the extension, then drives a real browser
bun test:e2e:fast   # skips the build; use while iterating on specs only
bun test:e2e:smoke  # build + the handful of @smoke-tagged critical specs
bun test:e2e:ui     # the same, in Playwright's inspector
```

`test:e2e:fast` runs against whatever is already in `build/` and `build-e2e/`,
so a stale build passes or fails for the wrong reasons — rebuild
(`bun run build:e2e`) after any change under `src/`.

e2e tests run in parallel (3 workers locally, 2 in CI): each test launches its
own browser on its own temp profile, so they share nothing but the static
fixture server. Pass `--workers=1` to debug. A test that only fails in
parallel is telling you about a real race — the first one found this way was
`useMemoryAutosave` letting a slow snapshot overwrite freshly typed values.

3 workers means up to 3 full Chromium instances launching at once, which is
a real cost on a loaded machine — distinct from "Timeouts waiting on a
button" below. A `Test timeout of Nms exceeded while setting up "context"`
failure is the browser itself failing to launch in time, not a race in the
extension: check `uptime` before anything else, and rerun with `--workers=1`
(or just that file) if the host was busy.

`bun:test` is the runner — it is what the repo and CI already use, so there is no
Vitest here.

## Why the tests are fast

`src/core` imports no React, no browser APIs and no network clients — enforced by
lint. So the domain layer runs in plain Bun with no DOM, no extension host and no
mocking of either. The unit suite runs in well under a second.

Keeping it that way is a design constraint, not a happy accident. If a domain
test starts needing a DOM, the logic is in the wrong layer.

## What to test where

| Layer | Runner | What |
|---|---|---|
| `src/core/**` | `bun test` | Ontology, matching, state transitions, tool schemas, policy, providers |
| Adapters (`src/lib`) | `bun test` with fakes | Storage, messaging, site access, Chrome/Firefox toolbar-icon wiring |
| End to end | `bun test:e2e` | The built extension in real Chromium, plus the fixtures |

### File preparation, specifically

Bun has no `canvas` and no `createImageBitmap`, and that fact decides where a
file-preparation test goes — not preference.

Everything that can be expressed as arithmetic lives in `src/core/files/` and is
unit-tested: unit conversion, aspect-ratio parsing and locking, crop-rectangle
clamping, byte limits, and the form-to-spec resolver. The crop clamp in
particular is core code *because* of this rule — a selection escaping the image
is a geometry bug, and stating it as `rectContains(image, selection)` means it
is covered by `bun test` instead of only by an end-to-end drag.

What genuinely needs pixels — encoding, the compression ladder, the downscale
fallback — stays end-to-end in `e2e/files.spec.ts`. Do not reach for a canvas
polyfill to move those into `bun test`; the polyfill would be the thing under
test.

## The fixture site

```bash
bun dev:site   # http://localhost:4173
```

| Fixture | Exercises |
|---|---|
| `simple.html` | Well-formed: `<label for>` on every control, all common input types. |
| `messy.html` | No labels at all. Opaque names (`fld_1`), placeholder-only fields, meaning in adjacent text, a bare "Year" that is genuinely ambiguous, a Hindi label, and an Aadhaar field that must never be auto-filled. |
| `dynamic.html` | Fields injected after load and between steps, plus page-level validation. Observation must be re-run rather than cached. |
| `controlled.html` | A React-controlled input, a masked phone field, a custom combobox and a strict-format date — the fill-time hard cases. |

**"100% field detection" is not a well-formed metric**, and `simple.html` does not
reach it: it has 12 in-scope controls (the `csrf` hidden field is never a
candidate), and the ontology maps 9 of them. "Cover note", "Preferred contact
method" and "I accept the terms" have no concept and are correctly abstained on
— an abstention there is a *correct* outcome, not a miss. `bun run eval` prints
the real breakdown across all five outcomes (`resolved_correct`,
`resolved_wrong`, `abstained_correct`, `missed`, `ambiguous_correct`); see
`~/core/matching/eval` and the phase 1b handback for the numbers.

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

`e2e/` holds the browser-level specs (about seventy). They run headless in a
couple of minutes and guard one thing unit tests structurally cannot: that the **built artefact**
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
| Side panel renders **when framed** | A CSP that blanks the panel Chrome actually shows |
| Side panel / popup / options render | A broken entrypoint, and any console error |
| Boots with no configuration | Env vars becoming required again |
| Fixtures keep their shape | `messy.html` being "tidied up" into uselessness |

The framing test earned its place immediately. An earlier version of this suite
checked the side panel by navigating to `sidepanel.html` top-level, which passed
while `frame-ancestors 'none'` in the CSP was blanking the real panel — Chrome
renders it inside a frame. A test that exercises the wrong condition is worse
than no test, because it is believed. The framing test reproduces what Chrome
actually does.

The manifest test is the other valuable one. `docs/privacy.md` warns that removing the
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

**Chromium only — there is no Firefox e2e, and there cannot be one with this
toolchain.** Two Firefox-only bugs shipped undetected in one session: the
toolbar icon did nothing on Firefox (nothing wired `browser.action.onClicked`
to `sidebarAction.toggle()`, the Firefox equivalent of Chrome's
`sidePanel.setPanelBehavior`), and the dev server's CORS policy blocked
`moz-extension://` origins, rendering the side panel blank in `wxt -b
firefox` dev mode. Both are now covered as fast, dependency-injected unit
tests instead of e2e — `~/lib/tests/toolbar-icon.test.ts` (verified to fail
against the old logic) and `scripts/tests/dev-server-cors.test.ts` — following
the same fake-browser pattern as `~/lib/site-access`.

A real-Firefox e2e smoke test (navigating to `moz-extension://<id>/...` pages
in an actual Firefox, mirroring what `e2e/extension.spec.ts` does for Chrome)
was attempted and is **not possible with Playwright**: Firefox refuses to load
an unsigned extension — whether an unpacked directory or a `.xpi` — dropped
into `<profile>/extensions/`, silently deleting it at startup even with
`xpinstall.signatures.required: false` set. That pref only takes effect on
Nightly/Developer Edition builds; Playwright ships a release-channel Firefox,
so there's no way to disable signature enforcement from the outside. (This was
verified empirically with throwaway scripts against Playwright's real
bundled Firefox, not assumed from docs.) The only genuinely working mechanism is
`selenium-webdriver` + `geckodriver`'s `installAddon(path, temporary=true)`, a
separate toolchain not currently in this repo; picking that up is a real,
scoped decision for whoever needs it next, not a gap to quietly paper over.

**No test anywhere simulates a real click on the browser's native toolbar
icon, in either browser.** Playwright cannot drive browser chrome — only page
content — in Chrome or Firefox. `e2e/extension.spec.ts`'s "toolbar icon opens
the side panel" test only asserts the manifest shape (`openPanelOnActionClick`
would be honored, given no `default_popup`); the Firefox click-wiring *logic*
is proven the same indirect way, via `~/lib/tests/toolbar-icon.test.ts`.
Whether a real click reaches it in either browser stays a manual verification
step.

### Timeouts waiting on a button

The most common e2e failure looks like this:

```
Test timeout of Nms exceeded.
Error: locator.click: Target page, context or browser has been closed
Call log:
  - waiting for getByRole('button', { name: '...' })
```

**Assume a stale locator before assuming a slow machine.** The panel renders
different controls depending on what a scan finds, and a locator that no
longer matches the state the test reaches is indistinguishable from a hang.
This exact failure hid a real break for a while: the summary-card redesign
stopped rendering "Answer now and never again" when every detected field
already had a stored answer (the answers card offers a one-shot "Fill My
Form" instead), and the specs that waited for the old button timed out.

Check, in order:

1. Open the failure screenshot / `error-context.md` under `test-results/`.
   Is the control the test waits for actually on screen?
2. Flow-driving controls are located by test id (`scan-button`,
   `agent-start`, `agent-confirm`, `agent-answer`, `proposal-confirm`,
   `fill-answers`; helpers in `e2e/fill-helpers.ts`), not by visible copy.
   If you add a control a test drives, give it a test id.
3. Only then consider load (`uptime`, free memory). A test that passes alone
   and fails only in the full run on a busy host is a resource problem; one
   that fails consistently is not.

Two real bugs found earlier while chasing timeouts, so they are not
rediscovered as "maybe this is it": `~/core/agent/loop`'s `performFill` used
to read the tool-execution envelope's `ok` instead of the fill's actual
`{ ok: false }` payload, and the per-field verification retry cap used to read
`AgentState.attempt`, which the reducer resets on every `planned` event.
`RunSnapshot.cursorAttempts` is the field-level counter now.

## Not yet built

**An evaluation runner.** A JSON dataset of `label → expected concept key`
iterated by a normal test is the first version, and it arrives with the first
mapping implementation. Building a `datasets/ cases/ runner/ metrics/` framework
before there is a single mapping to measure would be scaffolding around an empty
room.
