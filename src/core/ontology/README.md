# `ontology/` — canonical concepts

`concepts.json` is the source of truth. Code reads it; code does not embed
concept knowledge. That is what makes the ontology extensible by editing data
rather than by touching call sites.

## Adding a concept

Append an object to `concepts.json`:

```json
{
  "key": "identity.nationality",
  "label": "Nationality",
  "sensitivity": "sensitive",
  "volatility": "stable",
  "expects": "text",
  "aliases": { "en": ["nationality", "citizenship"], "hi": ["राष्ट्रीयता"] }
}
```

`ontologySchema.parse` runs at import, so a malformed entry fails loudly at
startup and in tests rather than degrading silently at runtime.

Two properties of the concept are declared here, once, and drive behaviour
elsewhere:

`sensitivity` drives `~/core/policy`. Get it right: it is the difference between
a field being filled automatically and one that requires explicit confirmation.

`volatility` drives freshness — how long a stored value is trusted before the
user is asked to confirm it. `permanent`, `stable`, `slow`, `volatile`, or
`self_dated` for values that are themselves a date. The durations attached to
each class are policy and live outside this file. A wrong choice is quiet: too
long means a stale value is filled confidently, too short means the user is
nagged. See [ADR 006](../../../docs/adr/006-value-freshness-and-expiry.md).

Aliases are surface forms seen on real forms, in any language. They power the
deterministic and keyword tiers that run *before* any model is consulted.
They map a *field's label* to this concept — don't confuse them with the
optional `valueAliases`, which map a stored *value*'s synonyms to a page
option's canonical form (`{ "indian": "india" }` on `identity.nationality`,
so a `<select>` offering "India" still resolves). Only meaningful for
closed-vocabulary concepts; see `~/core/matching/resolve-option`.

## What lands here next

Fuzzy and token-overlap matching, then semantic retrieval — added as new tiers
behind `ConceptIndex`, so callers do not change.
