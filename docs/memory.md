# Memory

Personal memory is local-only. `biome.json` forbids `src/core/memory/**` from
importing any network, cloud or model client, so the guarantee is mechanical
rather than aspirational.

## Provenance is mandatory

Every `MemoryItem` carries a `MemoryProvenance`:

```ts
{
  key: "education.secondary.completion_year",
  value: "2019",
  provenance: {
    source: "user_provided",
    confidence: 1,
    confirmedByUser: true,
    createdAt: "...",
    updatedAt: "...",
  },
}
```

`source` is what lets policy distinguish "the user typed this" from "we inferred
it". `MemorySource.INFERRED` values always require confirmation before use.
`confirmedByUser` tracks whether the user has accepted *this exact value* — it
resets when the value changes.

`evidence` is a non-personal note about origin: a document id, an origin, a run
id. Never the surrounding text, never the value.

## Values go stale, and staleness is a question

Every item also carries an optional `expiresAt`. Absent means the value does not
rot — a date of birth is correct forever. Present means we stop trusting it
silently after that moment.

How long a concept is trusted comes from its `volatility`, declared in
`concepts.json` next to `sensitivity`: `permanent`, `stable`, `slow`, `volatile`,
or `self_dated` for values that are themselves a date, like a passport expiry.
The durations attached to those classes live in a separate, tunable policy
document, because "how long do we trust an employer" is an operational decision
and adding a concept is a code change.

Reaching the horizon **downgrades trust; it never deletes and never blocks**. A
stale value lowers effective confidence, policy returns `REQUIRE_CONFIRMATION`,
and the user gets a yes/no on the value we already hold — "Still at Kirloskar
Systems?" — not an empty box. Confirming refreshes the horizon from *now*.

Freshness is evaluated on read by a pure function with an injected `now`, during
RETRIEVE, when the value is about to matter. There is no background sweep: a
service worker is the wrong place to promise periodic work.

Where a stable anchor exists, prefer deriving over expiring. "Years at this
address" stored as `3` is wrong in a year no matter what happens; stored as
`residence.current.moved_in_date` it is right forever and never asks.

See [ADR 006](./adr/006-value-freshness-and-expiry.md), which also covers the
direction of the arrow for admin-panel configuration.

## The model never writes

There is no `set_memory` tool, and there will not be one. The model may
*propose* a write; the write happens through an application service after policy
evaluation and, where required, user confirmation.

This is what makes prompt injection survivable. A malicious page can persuade the
model to say anything, but the worst it achieves is a proposal the user is shown
and can reject. It cannot silently corrupt what the extension believes about the
user.

## Retrieval

`MemoryQuery` is the seam. The first implementation matches keys, labels and
ontology aliases. Semantic retrieval slots in behind the same `text` field later
and no caller changes.

That ordering is deliberate: build the deterministic tier, measure how far it
gets, and add embeddings only against a number. Embeddings before measurement is
how you end up with a vector database solving a problem string matching already
solved.

## Implementation order

1. **In-memory** — tests.
2. **IndexedDB** — production. Handles the size and structure a personal
   knowledge base needs; `chrome.storage` does not.

A remote-backed store is deliberately not planned. If one is ever needed it
becomes an explicit, separately-consented feature with its own ADR, not an
adapter quietly swapped in behind the interface.

## Sensitivity

A concept's `sensitivity` is declared once, in `ontology/concepts.json`, and
drives `~/core/policy`:

| Sensitivity | Examples | Default handling |
|---|---|---|
| `public` | Country, language | Automatic |
| `personal` | Name, email, employer | Confirm before filling |
| `sensitive` | Date of birth, address, resume | Confirm before filling |
| `restricted` | Government ids, credentials, financial | Explicit confirmation, always |

Getting `sensitivity` right when adding a concept matters more than getting the
aliases right — aliases affect accuracy, sensitivity affects whether personal
data is disclosed without asking.
