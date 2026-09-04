# 007 — Shared site knowledge: anonymous, corroborated, and only ever a hint

**Status:** accepted · 2026-09-04

## Context

A form rejects an upload. The page says "max 49 KB"; the file we sent was 48.7 KB
and it was still refused. Somewhere there is a server checking against 48 KB, or
against 49,152 bytes, or counting the base64 envelope.

Discovering that costs a round of model calls, a failed submission and some of
the user's patience. It is also the same discovery for every user of that form,
in every country, forever. Rediscovering it per-device is the definition of
waste.

Four things want the same pipe: per-site quirks, per-form success rates,
multilingual label coverage, and user-reported issues. All four are facts about a
*website*. None are facts about a *person*.

But the pipe points the wrong way. [ADR 003](./003-local-first-memory-boundary.md)
made "personal data does not leave the device" a build failure, and
[privacy.md](../privacy.md) says configuration flows down and nothing flows up.
This ADR opens a narrow upward channel, so it has to be narrow in a way that is
checkable rather than promised.

## Decision

A shared site-knowledge service exists. Devices **observe**; the service
**concludes**; devices **receive hints**.

### A device observes, it does not decide

"Was this failure specific to me or my session?" is unanswerable on one device,
because one device has n=1. It is answerable across many, and only there. So the
client never records a conclusion — it records what it saw:

```
origin, formKey, fieldKey, issueCode, statedConstraint?, observedConstraint?
```

The service aggregates. A fact becomes a published hint only after **independent
corroboration from k distinct devices** — never on one report. This is the same
reason it is safe: one device's contribution is meaningless on its own, and a
fact that k strangers all observed is by construction not about any of them.

### Contribution is a narrowing, not a redaction

The payload is built by construction from a closed schema with no index
signature, exactly like `LogFields`:

```ts
export interface SiteObservation {
  readonly origin: string;          // registrable origin, never a full URL
  readonly formKey: string;         // hash of form structure, not its content
  readonly fieldKey: string;        // stable field identity, not the label
  readonly issueCode: VerificationIssueCode;
  readonly conceptKey?: string;     // a key, never a value
  readonly statedLimit?: number;
  readonly observedLimit?: number;
  readonly agentPhase?: string;
}
```

Redaction takes a rich object and strips the bad parts, which fails open the day
someone adds a field. Narrowing constructs a new object that can only hold
enumerated things, which fails closed. `VerificationIssue.expected` and `.actual`
are therefore *unrepresentable* here — the type will not carry them.

Before sending, the client screens the payload against the user's own memory and
drops anything containing a stored value. It is the one place with both halves,
and it costs a string scan.

### The leak is not the fields, it is the origin

A contribution containing zero personal data still says *this person was on this
site*. A stream of them is a browsing history, and the sites this product is for
— immigration, tax, university admissions, benefits — are exactly the ones where
that is sensitive.

So:

**Contributing is opt-in**, and the panel shows exactly what would be sent, per
origin, before it goes. Receiving hints is not opt-in, because nothing goes up.

**The contribution channel is unauthenticated and carries no account
identifier.** This is the rule that matters most, and it is in direct tension
with the billing channel in [monetization.md](../monetization.md), which does
carry one. The two must not share a transport, a session, or timestamps precise
enough to rejoin them. Joined, they are an authenticated browsing history of
paying customers, which is the single worst artefact this product could produce.

**Contributions are batched and delayed**, decoupled from the fill that produced
them, so send timing does not reconstruct a session.

**Any origin can be excluded permanently** in one click, and exclusion is
remembered locally.

### A hint may save work. It may never widen what is allowed

A downloaded fact can reorder the deterministic tiers, pre-load a known field
mapping, and skip a model call. That is the whole point, and it is a large win:
the second user of a form pays none of the discovery cost the first user paid.

It may not do any of the following, and these are enforced on the receiving side,
not trusted from the sender:

- raise confidence past a confirmation threshold for a `sensitive` or
  `restricted` concept
- cause a first fill of a concept on this device without the normal confirmation
- introduce a concept mapping that contradicts one the user has confirmed
- alter `sensitivity`, `volatility`, or anything in the ontology's safety half

Hints are schema-validated and clamped on receipt, like the freshness durations in
[ADR 006](./006-value-freshness-and-expiry.md). A poisoned knowledge base must be
able to waste a model call, and must not be able to steer a passport number into
the wrong field.

## Alternatives

**Keep everything local; rediscover per device.** Perfectly private and honestly
wasteful — every user pays the same discovery cost, and the product never gets
better at a form because someone else used it. Rejected on the strength of the
compounding, which is most of the long-term value.

**Ship curated site knowledge from us, no contributions.** No upward channel at
all, so no browsing-history question. We would be hand-maintaining form quirks
for every government portal on earth, which does not scale past one country and
does not scale at all for languages we do not read.

**Contribute authenticated, tied to the account.** Much easier: one channel,
existing auth, spam handling for free, and per-user support ("show me what this
user hit"). It is also the artefact described above. Rejected, and worth stating
plainly because it is the path of least resistance and someone will propose it
during an incident.

**Full local anonymity via differential privacy or PIR.** Stronger than k-anonymous
corroboration, and disproportionate for facts that are already public properties
of public web pages. Revisit if contributions ever carry anything less public.

## Consequences

Good:

- The failure taxonomy, success rates, multilingual aliases and issue reports all
  ride one pipe with one safety review, rather than four telemetry systems each
  with its own leak.
- Token cost falls with adoption instead of scaling with it. A corroborated form
  fills deterministically.
- "Was this just me?" becomes answerable, which no amount of cleverness on one
  device could achieve.

Bad:

- We now run a service that can be poisoned, and corroboration thresholds are a
  weak defence against a determined actor with many devices. The receiving-side
  limits are what actually hold, so they must not be relaxed for convenience.
- Two channels that must never be joined is an ongoing discipline, not a
  build-time guarantee. It deserves a test that fails if the contribution client
  ever imports the auth client.
- Opt-in contribution means the knowledge base grows slower, and the users most
  likely to opt out are on the sites we most want coverage of.
- `formKey` stability is unsolved. A hash of form structure changes when the site
  redeploys, and too-loose a key merges distinct forms. Expect this to be the
  main source of wrong hints.

## When to revisit

When contribution volume makes k-anonymity real (early on it will not be, and
thresholds should start conservative), or if any proposal arrives to put an
account identifier on a contribution. The answer to that proposal is in the
Alternatives section, and it is no.
