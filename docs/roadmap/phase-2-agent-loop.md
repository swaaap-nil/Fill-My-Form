# Phase 2 — The reducer, the loop, and verification

**Depends on:** 1c. **Unblocks:** 3, 4.

## Goal

Phase 1c fills a form from a straight-line function. This phase replaces that driver with the
state machine the whole architecture was designed around, and adds the step that proves a fill
actually happened.

Two things make this more than plumbing: a run must survive the service worker being killed
mid-way, and verification must be able to fail. A verification step that has never produced a
failure has never been tested.

## Required reading

- [`_context.md`](./_context.md) first.
- `src/core/agent/types.ts` — the whole file. `PHASE_TRANSITIONS` and `canTransition` are
  already written and tested; you are building the missing half.
- `src/core/verification/types.ts` — `VerificationIssueCode`, `Verifier`.
- `docs/agent.md` — the phase diagram, progressive disclosure, and the trust pipeline.
- The 1a handback — specifically which write technique drove each control in `controlled.html`.

## Inline context

```
OBSERVE → UNDERSTAND → RETRIEVE → PLAN → ACT → VERIFY → DONE
                          ↑                       │
                          └───────────────────────┘   failed verification
```

`AgentPhase` is where the run is; `AgentStatus` is whether it is moving and why. They are
orthogonal — a run can be `waiting_for_user` in any phase.

**A failed verification returns to PLAN, never straight to ACT.** A retry must be re-decided,
not repeated. `canTransition` already encodes this and a test already asserts it.

```ts
VerificationIssueCode =
  value_mismatch | not_applied | value_normalised
  | field_invalid | field_missing | form_changed
```

`VerificationIssue.expected` and `.actual` may contain personal data. They exist for the review
UI and the agent's next decision. Log `code` and `fieldId` only — `LogFields` will not let you
log the others by accident, and that is deliberate.

## Deliverables

### 1. The reducer

`src/core/agent/reducer.ts` — pure `(AgentState, AgentEvent) → AgentState`. No IO, no clock, no
randomness.

**Tests:** yes, unit, including a **property test**: for any random sequence of `AgentEvent`s,
the reducer never produces a phase pair for which `canTransition` is false, and never leaves a
terminal status. **Why:** the transition table is already tested in isolation; what needs
proving is that the reducer cannot violate it, and the space of event sequences is too large to
enumerate by hand.

### 2. The loop

`src/core/agent/loop.ts` — pure, with all IO injected (the tool registry, the policy engine, the
memory store, the clock). It drives phases and emits events; it does not touch the DOM, storage
or the network.

Keep progressive disclosure intact: `ToolRegistry.describe(domains)` is called with the domains
for the *current phase*, and there is deliberately no "list everything".

**Tests:** yes, unit, driving the loop with fakes end to end through a full fill. **Why:** if
this needs a DOM to test, the IO is not properly injected and the design has drifted.

### 3. Resumability

Persist the run snapshot on every transition (`chrome.storage.session` is the natural home) and
resume from it.

**MV3 kills the service worker after ~30 seconds idle, and an `ask_user` round trip is easily
longer than that.** This is not an edge case; it is the normal path for the product's central
interaction.

**Tests:** yes, two.
1. Unit: assert the run round-trips through `JSON.parse(JSON.stringify(run))` unchanged after
   every transition. The types are serialisable by construction; nothing currently proves it.
2. e2e: kill the worker mid-run (`ServiceWorker.stopWorker` via `context.newCDPSession`) and
   assert the run resumes. If that CDP route is unavailable for extension workers, fall back to
   asserting the persisted snapshot and resuming from it in a fresh worker — and say which you
   did.

**Why:** this is the single most likely cause of "it just stopped working" in the wild, and it
is invisible in development where the worker stays warm.

### 4. The `Verifier`

`src/lib/form/verify.ts` — reads the DOM back and compares intent against reality. An adapter,
outside `src/core`.

**Two rules to encode:** it must never read a `password` field, and `expected`/`actual` must
never reach a log.

**Tests:** yes, e2e against `controlled.html`. Assert that the naive `.value` write raises
`NOT_APPLIED`, and that the technique 1a identified clears it. Also assert the masked field
produces `VALUE_NORMALISED` rather than `VALUE_MISMATCH` — the page reformatting what you typed
is a different outcome from the page rejecting it, and conflating them will produce retry loops.
Plus one unit test asserting a `password` field is never read.

**Why:** `controlled.html` exists precisely so verification has something real to fail against.
Testing it only on vanilla inputs tests nothing.

### 5. Re-observation on dynamic forms

`dynamic.html` injects a field at 600 ms and three more after a step transition. Observation
must be re-run rather than cached.

**Tests:** yes, e2e. Assert the run re-observes rather than serving a cached `PageObservation`,
and that a `FORM_CHANGED` issue returns the run to PLAN, not straight to ACT. **Why:** the
fixture was built for this, and "we cached the form" is the kind of optimisation that arrives
later and breaks it silently.

### 6. The `ask_user` round trip

`ask_user` suspends the run in `waiting_for_user`, the panel asks, the answer resumes it, and —
per 1c's write path — the value reaches memory through the application service, never through
a tool.

**Tests:** yes, e2e, combined with the resumability test above. Ask, kill the worker while
waiting, answer, assert the run completes. **Why:** this combination is the realistic failure
and neither test alone catches it.

## Gate

```bash
bun check
bun run build
bun test:e2e
```

- The property test passes over a meaningful number of generated sequences.
- The worker-restart test passes (or its documented fallback does).
- `controlled.html`: `NOT_APPLIED` is produced by the naive write and cleared by the real one.
- `dynamic.html`: re-observation happens; `FORM_CHANGED` routes back to PLAN.
- The full `e2e/fill.spec.ts` from 1c still passes, now driven by the loop rather than the
  straight-line function.

## Decisions to record in the handback

- Where the snapshot is persisted, and the size of a typical run.
- Which worker-kill technique worked.
- Whether any `VerificationIssueCode` turned out to be missing — and if so, escalate rather
  than adding one silently.
- Whether driving `controlled.html`'s combobox needed something `AgentAction` cannot express.
  **This is a security decision, not a feature decision — escalate, do not widen the union.**

## Out of scope

No model — Phase 3, and only if 1b's numbers justify it. No IndexedDB. No files. No new tools
beyond what the loop needs to drive the existing fill.

## Traps

- **Making the loop `async` all the way down and calling browser APIs from it.** It is pure with
  injected IO. The moment it imports `wxt/browser`, `bun lint` fails and the design has drifted.
- **Retrying a failed verification by repeating the action.** The transition table forbids it
  and a test asserts it. The retry goes through PLAN.
- **Treating `VALUE_NORMALISED` as a failure.** A masked phone field reformatting `9884421077`
  is usually success.
- **Caching `PageObservation` across an action** because re-observing feels wasteful.
  `dynamic.html` exists to catch this.
- **Widening `AgentAction`** to make the combobox work. Escalate.
