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

## 8b — Shared site knowledge

Devices contribute anonymous `SiteObservation`s; the service corroborates across k devices; hints
come back down. The failure taxonomy in `docs/learning.md` is mostly arithmetic — only the
genuine residual is worth a model call, and a model asked "why did this fail" will produce a
fluent answer for the arithmetic rows too.

Multilingual coverage falls out of the same pipe: a surface form paired with a concept key is a
fact about a public web page, and corroborated it becomes an alias for everyone. The ontology
grows in languages nobody on the team reads.

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

## Gate

Deliberately unset. Write it when 8a and 8b are split into real briefs, informed by what v1's
users actually hit.

## Escalate if

- Anyone proposes putting an account identifier on a contribution "temporarily, for debugging".
  ADR 007's Alternatives section answers this, and the answer is no.
- A dashboard requires a per-user record to compute. `docs/learning.md`'s rule: if a number
  cannot be computed from site-keyed observations, it is not collected.
