# Phase 8 — The cloud layer

**Depends on:** 7.

> **Sketch.** Two large phases wearing one number; split them before handing anything over.
> Nothing here should start until v1 has real users, because the whole design depends on
> corroboration across many devices and k-anonymity is meaningless at small n.

## Goal

Make the product get better as more people use it, without ever learning who they are.

## Required reading

- [`_context.md`](./_context.md) first.
- `docs/adr/007-shared-site-knowledge.md` — the whole thing.
- `docs/learning.md` — the failure taxonomy and where multilingual coverage comes from.
- `docs/monetization.md` — the entitlement boundary, and the open per-fill vs per-day question.

## 8a — Entitlement

Accounts and billing return here. `src/lib/supabase.ts` has been dormant since Phase 0
specifically so this is less work.

The open decision, recorded in `docs/monetization.md` and still unresolved: metering **per fill**
versus **per active day**. Per fill tracks value delivered but puts a network round trip on the
one action that should feel instant, and adds a failure mode to every fill. Per active day
amortises the check and is worth less to bypass. Decide with real usage data, not in advance.

Two rules regardless: a failed entitlement check **degrades rather than bricks** — a paid product
that stops working on a train is worse than one that occasionally gives away a day — and the
entitlement call never rides along with anything that has seen memory.

## 8b — Consent, then contribution

### The consent prompt

Nothing transmits until the user says yes. The prompt is a single, un-nagging ask:

> **Can we collect anonymous analytics to improve the extension?**
> *Please?*
> [See what will be shared]

"See what will be shared" is the load-bearing part, and it must show the **actual payload** —
the real entries queued from this device right now, not a prose description of them. A user who
can read exactly what leaves is a user who can trust the answer, and it is the difference
between consent and a checkbox.

Rules the prompt must obey, because they are also store-review rules:

- **Off by default.** Nothing queued for sending is sent before the answer.
- **Asked once.** Declining is a final answer, not a reason to ask again next week. A consent
  prompt that returns is a dark pattern and reviewers treat it as one.
- **Revocable**, from settings, with the same "see what would be shared" view.
- No pre-ticked boxes, no consent bundled into onboarding, no feature held hostage behind it.
  The extension must be exactly as useful for someone who says no.

### What gets contributed

Two kinds of observation, both already being collected locally by then:

**Unresolved fields** — the field journal built in Phase 1b. This is the compatibility engine:
the top unmatched labels across the fleet are, in frequency order, exactly the aliases and
concepts to add next. Each one added moves fields from "asks the user" to "fills
deterministically", for everyone, permanently, with no model call. See
[learning.md](../learning.md).

**Fill failures** — the taxonomy in `docs/learning.md`, which is mostly arithmetic. Only the
genuine residual is worth a model call; a model asked "why did this fail" will produce a fluent
answer for the arithmetic rows too, and be wrong often enough to poison what you store.

Multilingual coverage falls out of the same pipe: a surface form paired with a concept key is a
fact about a public web page, and corroborated it becomes an alias for everyone. The ontology
grows in languages nobody on the team reads.

The service corroborates across k devices before publishing anything as a hint. One device's
contribution is meaningless alone — which is exactly why it is safe to send.

## 8c — The admin panel seam

Not built here. The requirement is that it can be **connected later without redesigning
anything**, and that is achieved by one thing: the device already consumes a versioned,
schema-validated, remotely-supplied config document. ADR 006's freshness duration table is the
first instance of it.

Generalise that document rather than adding a second channel. One versioned config carrying:
freshness durations today; feature flags; **ontology overlays** — new aliases and concepts
pushed without shipping a build, which is how a field discovered on Monday is filling by
Tuesday; and entitlement from 8a.

The rules are the same ones that already apply to hints, and they are what let an admin panel
exist without becoming a back door:

- **Config flows down only.** The panel writes a document; devices read it. Nothing about an
  individual user flows up to populate it.
- **It is untrusted input.** Schema-validated on receipt and clamped in code, so a bad or
  hostile document cannot set every freshness horizon to zero or a century.
- **It may never widen what fills without confirmation.** A pushed ontology overlay can add an
  alias; it cannot change a concept's `sensitivity` or `volatility`, and it cannot cause a
  first fill without asking.
- **A device that never reaches the network keeps working** on the bundled default.

The panel's own view is built from **site-keyed aggregates** — top unresolved labels, per-form
success rates, corroboration counts. Never per-user records. `docs/learning.md` carries the
rule: if a number cannot be computed from site-keyed observations, it is not collected. "37% of
users have a stale employer" is per-user telemetry wearing a percentage sign.

## The constraints that make this survivable

| Constraint | Why |
|---|---|
| Contribution payloads are built from a **closed schema**, never redacted from a rich object. | Redaction fails open the day someone adds a field; narrowing fails closed. Same reasoning as `LogFields`. |
| Payloads are **screened against the user's own memory** before sending. | The client is the only party holding both halves. It costs a string scan. |
| The channel carries **no account identifier**, is batched, delayed, and opt-in. | A stream of origins is a browsing history even with zero personal fields, and this product's sites — immigration, tax, benefits — are the sensitive ones. |
| The contribution and billing channels **never share a transport, session, or correlatable timing**. | Joined, they are an authenticated browsing history of paying customers. |
| Hints may save work; they may **never** widen what is filled without confirmation. | A poisoned knowledge base must be able to waste a model call and nothing more. |

## Testing decisions

| Deliverable | Tests | Why |
|---|---|---|
| Channel separation | **Yes** — a `noRestrictedImports` rule forbidding the contribution client from importing the auth client, plus a test asserting no contribution payload carries an account id. ADR 007 asks for exactly this. | It is the constraint most likely to erode under incident pressure, and the erosion is invisible in review. |
| Payload narrowing | **Yes, unit.** Assert the schema cannot represent a value, a label, or `VerificationIssue.expected`/`.actual`. | Make the type do the work. |
| Memory screening | **Yes, unit.** Seed memory with a sentinel, assert a payload containing it is dropped. | Cheap, and it catches interpolated personal data in labels. |
| Hint receipt | **Yes, unit.** A hint claiming a `restricted` concept is `public`, or raising confidence past a confirmation threshold, is rejected on receipt. | Trust boundary. Enforce on the receiving side; never trust the sender. |
| Corroboration threshold | **Yes, server-side.** A fact published below k. | The k-anonymity claim is the safety argument. |
| Consent gating | **Yes, e2e.** With consent unanswered or declined, assert zero network requests leave the extension during a full fill. Assert declining is not re-asked. | The whole promise. An analytics client that transmits before consent is the single worst bug this product could ship. |
| "See what will be shared" | **Yes, e2e.** Assert the view renders the actual queued payload, and that what is sent matches what was shown. | A preview that drifts from the payload is worse than no preview, because it is believed. |
| Config receipt | **Yes, unit.** A config document that sets a TTL to zero, or an overlay that alters a concept's `sensitivity`, is rejected or clamped on receipt. | The admin panel is a trust input the moment it exists. |

## Gate

Deliberately unset. Write it when 8a and 8b are split into real briefs, informed by what v1's
users actually hit.

## Escalate if

- Anyone proposes putting an account identifier on a contribution "temporarily, for debugging".
  ADR 007's Alternatives section answers this, and the answer is no.
- A dashboard requires a per-user record to compute. `docs/learning.md`'s rule: if a number
  cannot be computed from site-keyed observations, it is not collected.
- The consent prompt is proposed for onboarding, or for a second showing after a decline.
- An admin-panel feature needs a second channel, or needs config to flow upward.
