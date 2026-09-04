# 006 — Every value has a freshness horizon

**Status:** accepted · 2026-09-04

## Context

Memory that is written once and never re-examined rots quietly. The user tells us
in March that they work at Kirloskar Systems; in November they do not, and we
have no way to know. The value is still marked `user_provided`, still
`confirmedByUser: true`, still confidence 1 — every signal we have says it is
good.

This is the same failure the "never guess" rule exists to prevent, arriving
through a different door. A confidently wrong answer on a visa application is
not improved by the fact that it was true when it was written.

The rot is not uniform. A date of birth is correct forever. A postal code is
correct until a move. An employer, a job title, a salary and "years at this
address" go stale on their own schedule, and "years at this address" is wrong
after twelve months *whether or not anything changed*.

## Decision

Every `MemoryItem` carries a freshness horizon, and reaching it downgrades trust
rather than destroying data.

### The field

```ts
export interface MemoryProvenance {
  readonly source: MemorySource;
  readonly confidence: MemoryConfidence;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly confirmedByUser: boolean;
  /** ISO-8601. Absent means this value does not go stale. */
  readonly expiresAt?: string;
  /** Which rule produced `expiresAt`, so it can be explained and re-derived. */
  readonly freshnessRule?: string;
  readonly evidence?: string;
}
```

`confirmedByUser` and `expiresAt` are two different questions — *did the user
vouch for this exact value* and *how long ago* — and neither substitutes for the
other. Both stay.

### Volatility is a property of the concept, declared in data

`concepts.json` gains a `volatility`, alongside `sensitivity` and for the same
reason: it belongs to the concept, so it is declared once, in data, and never
re-derived at a call site.

```ts
export const Volatility = {
  /** Never goes stale. Date of birth, a completed degree's year. */
  PERMANENT: "permanent",
  /** Changes rarely and deliberately. Full name, nationality. */
  STABLE: "stable",
  /** Changes every few years. City, postal code, current address. */
  SLOW: "slow",
  /** Changes on its own schedule. Employer, job title, income. */
  VOLATILE: "volatile",
  /** The value *is* a date; it expires when it says it does. */
  SELF_DATED: "self_dated",
} as const;
```

`self_dated` exists because a passport expiry date needs no guess — the document
expires exactly then, and we should ask *before* that, not after. Its horizon is
the value itself minus a lead time.

### Durations live in a separate, tunable policy document

Volatility says *how a concept behaves*. How long each class is trusted is
policy, versioned separately, and this is the seam the admin panel controls:

```json
{
  "version": 3,
  "ttl": { "stable": "P5Y", "slow": "P1Y", "volatile": "P6M" },
  "leadTime": { "self_dated": "P30D" },
  "overrides": { "employment.current.title": "P3M" }
}
```

Two documents rather than one because they change for different reasons and by
different hands: adding a concept is a code change in a release, while retuning
"how long do we trust an employer" is an operational decision we want to make
without shipping a build. `permanent` has no entry and cannot be given one.

### Expiry downgrades; it never deletes and never blocks

An expired value is *shown to the user for confirmation*, not withheld and never
discarded. It flows into machinery that already exists: freshness lowers the
effective confidence, policy sees a stale value and returns
`REQUIRE_CONFIRMATION`, and the run asks through `ask_user` in the phase where it
already asks about everything else. No new phase, no new tool, no new UI concept.

The question is a yes/no on the value we already hold — "Still at Kirloskar
Systems?" — not an empty box. Confirming is one click and sets `expiresAt` to
`now + ttl`, computed from the confirmation, not from the old horizon.

### Freshness is evaluated on read, by a pure function

```ts
export type Freshness = "fresh" | "expiring_soon" | "due";
export const freshness = (item: MemoryItem, now: string): Freshness => /* … */;
```

Evaluated during RETRIEVE, when the value is about to matter. No background
sweep, no alarms, no timers — a service worker is the wrong place to promise
periodic work, and a value nobody is about to use does not need an opinion. `now`
is injected rather than read from `Date.now()` inside the domain, so the whole
thing is testable without clock mocking.

### Volatility can flip with the shape of the value

The user's employment has an implicit "still here" in it. When they later say
they left in March, that fact stops being volatile and becomes permanent — a past
job's end date never changes again. So the write path may override the concept's
declared class, and `freshnessRule` records which rule produced the horizon, so a
value can be explained in the review UI and re-derived when the policy document
changes.

### Prefer deriving over expiring

Where a stable anchor exists, store the anchor and compute the answer. "Years at
this address" should not be stored as `3` with a one-year horizon; it should be
`residence.current.moved_in_date`, which is `slow`, with the years computed at
fill time. A concept that can declare `derivedFrom` never goes stale and never
needs to ask. Reach for expiry only when there is no anchor to derive from.

## Alternatives

**No expiry; ask on every restricted field.** What `defaultPolicy` does today.
Correct for `restricted` concepts and useless for the ones that actually rot —
employer and address are `personal`/`sensitive` and would otherwise fill
silently forever.

**One global TTL.** A single number, no ontology change. Either it is short and
the extension nags about a date of birth, or it is long and an employer stays
wrong for a year. The whole value is in the per-concept distinction.

**Delete on expiry.** Simple and clearly wrong: it destroys a value that is
probably still correct, and turns a one-click confirmation into re-typing a
passport number.

**Background sweep with alarms.** Proactive nudges, at the cost of periodic work
in a worker that Chrome stops when it likes, plus a notification surface we do
not otherwise need. Evaluating on read gets the same protection at the moment it
matters.

**Durations inside `concepts.json`.** One document instead of two. Rejected
because it welds an operational knob to a code release, and because the admin
panel would then be editing the ontology.

## Consequences

Good:

- The failure mode this product must not have — a confident, stale, personal
  value on a government form — becomes a question instead of a silent error.
- It reuses everything: confidence, `REQUIRE_CONFIRMATION`, `ask_user`,
  provenance. The new surface is one optional field and one pure function.
- Confirmations are cheap and get cheaper. A yes/no that refreshes a horizon
  costs a click, and every confirmation makes the next fill deterministic again.
- Tuning is data. "Employers go stale in 3 months, not 6" is a policy edit, not a
  release.

Bad:

- A new way to annoy the user. Too-short horizons produce a confirmation
  treadmill, which is worse than the rot for anyone who moves and works at the
  same place for a decade. The durations above are guesses and must be tuned
  against real confirmation-rate data before they are trusted.
- `volatility` is now a second thing to get right when adding a concept, and a
  wrong one is quiet — over-long is a stale fill, over-short is nagging.
- Values written before this exists have no horizon. Migration treats a missing
  `expiresAt` as "derive on next read from the concept", not as "permanent".
- Two policy documents can disagree: a concept can name a volatility class the
  TTL document has no entry for. Unknown class must fall back to the most
  conservative configured duration, not to `permanent`.

## The admin panel, and the direction of the arrow

The TTL document is the first thing the SaaS layer controls on a device, so the
boundary needs stating before it is built.

Configuration flows **cloud → device**. It is non-personal — class names and
durations, identical for every user — and it is cacheable, so a device that never
reaches the network keeps working on the copy bundled with the build. That
matches the existing rule that the extension is fully functional with an empty
`.env`.

Nothing flows **device → cloud**. Not which concepts a user holds, not what is
stale, not confirmation rates per key. "37% of users have a stale employer" is a
tempting dashboard and it is per-user memory telemetry wearing a percentage sign;
if that number is ever genuinely needed it arrives as an aggregate the device
computes and the user consents to, with its own ADR.

A remotely-supplied document is untrusted input. It is schema-validated on
receipt the way `ontologySchema.parse` validates the ontology at import, and
durations are clamped to a sane range in code. A config that sets every TTL to
zero turns the extension into a confirmation prompt; one that sets them to a
century silently disables this ADR. Neither should be reachable from a text field
in an admin panel.

## When to revisit

Once there is confirmation-rate data. The durations are the part most likely to
be wrong, and they are the part designed to be changed without a release. If
users confirm "still at X" unchanged three times running, the horizon for that
key should probably lengthen on its own — a per-item backoff is the obvious next
increment, and deliberately not built now.
