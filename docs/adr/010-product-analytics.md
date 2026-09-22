# 010 — Product analytics: anonymous, closed-schema, on by default

**Status:** accepted, rollout paused · 2026-09-22

The client-side design below still stands. Actually sending events to
OpenPanel is paused pending a backend proxy — see
[analytics-rollout-status.md](../analytics-rollout-status.md) for why and what
resumes it.

## Context

The extension ships with no analytics today. `docs/privacy.md` already anticipates turning this
on ("When analytics is enabled... only anonymous product events") and `biome.json` already
restricts `src/core/**` from importing an analytics client — the boundary was designed before the
capability existed. This ADR is the act of building the capability inside that boundary.

The need is ordinary product visibility: which lifecycle events succeed or fail (scan, fill,
agent run), which features get used, and coarse locale/origin distribution — not which forms
specific people filled or what they typed. That distinction is the whole ADR.

This is deliberately **separate** from [ADR 007](./007-shared-site-knowledge.md)'s site-knowledge
contribution channel. That channel reports facts about *websites* (a field the ontology doesn't
know, a rejected upload size) and is opt-in and unauthenticated by necessity, because a stream of
per-origin reports is a browsing history. Product analytics here reports facts about *product
usage* aggregated by event name, not by origin-over-time, and carries a materially smaller
re-identification risk — the two channels must stay independent and must not be mergeable.

## Decision

### Client: OpenPanel

`biome.json` already names OpenPanel as the sanctioned client (alongside Supabase) for
`src/core/**`'s restricted-imports rule, so this ADR uses it rather than introducing a new vendor.
Wired exactly like `src/lib/supabase.ts`: optional, key-gated, `null` and a no-op `track()` when
`VITE_OPENPANEL_CLIENT_ID` is absent from `.env`. The extension remains fully functional and
fully anonymous out of the box with an empty environment, matching the existing Supabase pattern
and CI's empty-environment build.

Google Analytics was considered and rejected: `gtag.js` is a remotely hosted script, which
conflicts with this extension's CSP (`script-src 'self'; object-src 'self'`, no remote code) and
with Chrome's Manifest V3 policy against extensions executing remotely hosted code. GA's default
data shape (client ID, full page URL, referrer) also does not fit a closed, narrow event schema.

### Schema: closed, mirrors `LogFields`

`src/lib/analytics/events.ts` defines an `AnalyticsFields` interface with no index signature,
directly modeled on `LogFields` in `src/core/logging.ts`. Permitted fields: event name (from a
fixed enum), registrable `origin` (never a full URL or query string), locale, coarse counts and
durations, and enum-typed outcome/status codes. Adding a field is a deliberate, reviewed act, the
same discipline `LogFields` already enforces for logging.

Event names reuse the lifecycle already enumerated in `SFX_EVENT_CUES`
(`src/lib/sfx/events.ts`) — `scanStarted`, `scanSucceeded`, `fillFailed`, `agentCompleted`, etc. —
rather than inventing a parallel taxonomy. Sound and analytics describe the same underlying
lifecycle from two different call sites.

### Enforcement: same shape as memory's network ban

`biome.json`'s `src/core/**` restricted-imports rule is extended to forbid importing the OpenPanel
client directly. Instrumentation goes through `src/lib/analytics/`, never `src/core`, mirroring
how `src/core/memory/**` is already forbidden from importing Supabase or a model SDK.

### Default: on, with a visible opt-out

Analytics defaults to **on**, because the event schema is anonymous and aggregate by
construction — this matches how `docs/privacy.md` already classifies "anonymous usage metadata"
as cloud-eligible without a separate consent gate, unlike the personal-data-adjacent ADR-007
channel, which remains opt-in. A toggle in settings (`src/lib/analytics/preferences.ts`, same
`chrome.storage.local` pattern as `src/lib/sfx/preferences.ts`) turns it off; turning it off stops
all `track()` calls immediately, with no separate "delete my data" step needed because nothing
sent is attributable to an individual.

## Alternatives

**Opt-in by default.** Consistent with the product's "ask first" posture for anything personal,
but this data isn't personal — it's the same category `docs/privacy.md` already pre-classified as
cloud-eligible-by-default. Opt-in would slow data collection for no privacy gain, and would blur
the line with the genuinely sensitive ADR-007 channel by treating both as equally sensitive when
they are not.

**Google Analytics.** Rejected — see above; incompatible with the CSP and MV3 remote-code policy,
and shaped for websites, not a closed extension event taxonomy.

**Route site-usage counts through the ADR-007 channel instead of a separate one.** Rejected: that
channel's entire design (batching, delay, no account identifier, per-origin exclusion) exists to
prevent origin-over-time correlation. Folding ordinary "did the scan succeed" telemetry into it
would either weaken those protections or make the channel too slow/sparse to answer either
question well. Two schemas, two channels, one shared discipline (closed, narrow, reviewed).

## Consequences

Good:

- Product visibility (funnel health, feature adoption, coarse locale/origin distribution) without
  touching anything `docs/privacy.md` already promises stays local.
- Reuses an existing, tested pattern (`src/lib/supabase.ts`'s optional-client shape) instead of
  inventing a new one.
- The biome-enforced boundary means a future contributor adding a personal field to
  `AnalyticsFields` gets a build failure, not a code-review miss.

Bad:

- "On by default" means data starts flowing before any individual user has taken an action —
  defensible only because the schema is truly aggregate, and worth revisiting hard if that ever
  stops being true.
- Two upward channels (this one and the future ADR-007 one) existing side by side is a discipline
  to maintain, not a guarantee: a test should assert neither client imports the other's
  transport/keys once ADR 007 is built.

## When to revisit

If any proposed event field could identify a single device's behavior across sessions (e.g. a
stable per-install ID beyond what OpenPanel's own anonymous session handling provides), or if
this channel and the ADR-007 channel are ever proposed to share a transport or backend.
