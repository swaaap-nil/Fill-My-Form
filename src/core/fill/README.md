# `fill/` — the straight-line fill driver

Phase 1c's brief is explicit: no agent loop yet. `planFill` is a plain async
function that walks every field once:

```
resolve(field)  ->  memory lookup  ->  PolicyEngine.evaluate  ->  proposal
```

Nothing here writes to a page. `planFill` returns `FieldProposal`s (one of
`unknown`, `ambiguous`, `no_value`, `pending`, `restricted`) and a map of
pending decisions, keyed by an opaque `decisionId`. A value only reaches the
content script once the side panel calls `confirmDecision` for a specific
decisionId — which re-runs policy with `userConfirmed: true` — and the
background sends a `fillField` message carrying that same id. See
`~/core/messaging/fill-instruction` for the other half of that gate.

## What lands here next

Phase 2 replaces the *driver* — the reducer and the loop take over calling
`resolve`, the memory lookup and `PolicyEngine.evaluate` — not the pieces
themselves.
