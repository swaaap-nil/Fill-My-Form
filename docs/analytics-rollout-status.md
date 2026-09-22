# Analytics rollout status — paused

**Status:** paused · 2026-09-22

## What was planned

[ADR 010](./adr/010-product-analytics.md) added anonymous, on-by-default product
analytics via OpenPanel. The client-side implementation is built and merged:

- `src/lib/analytics/events.ts` — closed event allowlist + `AnalyticsFields` schema
- `src/lib/analytics/client.ts` — optional, key-gated `@openpanel/sdk` client
  (the minimal core SDK, not `@openpanel/web`, to avoid its bundled session-replay
  module and DOM auto-instrumentation)
- `src/lib/analytics/preferences.ts` / `track.ts` / `react.tsx` — the opt-out
  toggle (on by default) and the `track()` wrapper
- `src/lib/sfx/react.tsx` — `track()` wired into the existing `play`/`startLoop`
  dispatch point, so every sound-cue call site already reports analytics with no
  new call sites
- `src/components/memory/analytics-preference-control.tsx` — the settings toggle
- `biome.json` — `src/core/**` already forbidden from importing the client
- `docs/privacy.md` — updated to describe the live behavior

All of this is in the tree, lints, typechecks, and both `bun run build:chrome`
and `build:firefox` succeed with it. It is inert today because no
`VITE_OPENPANEL_CLIENT_ID` is set — the extension ships fully anonymous with an
empty `.env`, same as the Supabase pattern it mirrors.

## Why it's paused

While wiring up the OpenPanel project during testing, two blockers surfaced —
one practical, one architectural:

**1. Chrome: OpenPanel's "Allowed domains" UI can't take a `chrome-extension://`
origin.** OpenPanel's Website-type project checks the request's `Origin` header
against an allowlist. The dashboard's "Add a domain" input unconditionally
prepends `https://` to whatever is typed, producing a malformed
`https://chrome-extension://<id>` entry instead of the real origin
(`chrome-extension://<id>`), so every request from the extension gets rejected
with `Invalid cors or secret`. This may be fixable by editing the entry in
place rather than retyping, or may need a report to OpenPanel support — not
confirmed either way yet.

**2. Firefox: there is no fixed origin to allowlist at all.** Firefox
randomizes the `moz-extension://` UUID **per browser profile** as a deliberate
anti-fingerprinting measure — unlike Chrome, where a Web-Store-published
extension has one stable `chrome-extension://<id>` shared by every installer
(derived from the signing key). Every Firefox user gets a different,
unpredictable origin, so an origin-allowlist model cannot work for Firefox
users at all, regardless of whether blocker 1 is fixed.

Sending tracking requests directly from the extension to OpenPanel is
therefore a dead end for Firefox, and fragile-at-best for Chrome.

## The path forward, when this resumes

Route tracking through a small backend proxy instead of calling OpenPanel
directly from the extension:

- The extension calls an endpoint you control (any origin — you set that CORS
  policy yourself, no allowlist fragility).
- The backend holds the OpenPanel **client secret** and forwards to an
  OpenPanel **Backend/API**-type project, authenticated by secret rather than
  origin. Per OpenPanel's own docs, `clientSecret` is "only required for
  server-side events" — this is exactly that case.
- This also matches `docs/privacy.md`'s existing rule verbatim: *"Server
  secrets belong to a backend the extension talks to... it does not hold the
  key."* A secret was never going to be safe to ship inside the extension
  bundle, which the Website-type/no-secret path was trying (unsuccessfully) to
  route around.
- Candidate host: a Supabase Edge Function, since Supabase is already wired
  into this project for auth — see [privacy.md](./privacy.md)'s cloud-eligible
  boundary table.

Resuming this is: build the proxy function, point `src/lib/analytics/client.ts`
at it instead of directly constructing an `OpenPanel` client, and re-verify the
end-to-end flow (Network tab shows a request to *your* endpoint, your endpoint
forwards to OpenPanel, event appears in the dashboard) on both Chrome and
Firefox before considering this unblocked.
