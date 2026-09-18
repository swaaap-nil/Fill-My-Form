# `fill/` — the straight-line fill driver

Phase 1c's brief is explicit: no agent loop yet. `planFill` is a plain async
function that walks every field once:

```
resolve(field)  ->  memory lookup  ->  resolveOption (if closed-vocabulary)  ->  PolicyEngine.evaluate  ->  proposal
```

Nothing here writes to a page. `planFill` returns `FieldProposal`s (one of
`unknown`, `ambiguous`, `no_value`, `pending`, `restricted`, `choose_option`)
and a map of pending decisions, keyed by an opaque `decisionId`. A value only
reaches the content script once the side panel calls `confirmDecision` for a
specific decisionId — which re-runs policy with `userConfirmed: true` — and
the background sends a `fillField` message carrying that same id. See
`~/core/messaging/fill-instruction` for the other half of that gate.

## Closed-vocabulary fields (`<select>`, radio/checkbox groups)

A stored memory value ("OBC", "Indian") only means something once it maps
onto one of the *field's own* options — a page's option `value` is often an
opaque code (`value="2"`) with the real meaning only in the visible `label`
("OBC-NCL"). `~/core/matching/resolve-option` resolves that mapping
deterministically (exact → curated `valueAliases` → token containment,
never a guess) before a payload is built:

- **Resolved to exactly one option** — same `pending`/`restricted` shape as
  any other field, except the payload writes the *option's* `value`, the
  proposal displays the option's `label`, and `PendingDecision.memoryValue`
  keeps the original canonical text so a page-specific code never overwrites
  what memory remembers.
- **Ambiguous or no match** — `choose_option` instead: one `PendingDecision`
  is pre-registered per candidate option, each with its own live
  `decisionId`. Picking one is the ordinary `confirm([decisionId])` flow;
  no messaging-protocol addition was needed for this.

`src/lib/form/fill.ts#writeFieldValue` writes a resolved radio/checkbox
group by finding the member whose `.value` matches and toggling `.checked`
through the same native-setter-plus-event technique used for text inputs —
it never sees, and never needs to resolve, raw memory text itself.

## What lands here next

Phase 2 replaces the *driver* — the reducer and the loop take over calling
`resolve`, the memory lookup and `PolicyEngine.evaluate` — not the pieces
themselves.
