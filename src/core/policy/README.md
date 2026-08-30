# `policy/` — what the runtime is willing to do

The model proposes; this module disposes. Every automatic action passes through
`PolicyEngine.evaluate`, so tightening behaviour later is a change in one place.

`defaultPolicy` is a deliberately blunt default-deny stub. The rules are ordered
strongest-first:

| Situation | Effect |
|---|---|
| Final form submission | **deny** — always the user's own click |
| Destructive action | deny |
| `restricted` sensitivity (ids, credentials, financial) | confirm, unless already confirmed |
| Low confidence | confirm |
| `public` + `low` risk | allow |
| Everything else | confirm |

Sensitivity is declared once per concept in `ontology/concepts.json`, not
re-derived here.

## What lands here next

Per-field and per-site user preferences, and a real confidence model. The
submission rule stays.
