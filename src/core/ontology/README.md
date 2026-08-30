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
  "expects": "text",
  "aliases": { "en": ["nationality", "citizenship"], "hi": ["राष्ट्रीयता"] }
}
```

`ontologySchema.parse` runs at import, so a malformed entry fails loudly at
startup and in tests rather than degrading silently at runtime.

`sensitivity` is declared once, here, and drives `~/core/policy`. Get it right:
it is the difference between a field being filled automatically and one that
requires explicit confirmation.

Aliases are surface forms seen on real forms, in any language. They power the
deterministic and keyword tiers that run *before* any model is consulted.

## What lands here next

Fuzzy and token-overlap matching, then semantic retrieval — added as new tiers
behind `ConceptIndex`, so callers do not change.
