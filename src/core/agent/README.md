# `agent/` — the runtime

An explicit state machine, not an autonomous loop:

```
OBSERVE -> UNDERSTAND -> RETRIEVE -> PLAN -> ACT -> VERIFY -> DONE
```

`AgentPhase` is where the run is. `AgentStatus` is whether it is moving, and if
not, why (`waiting_for_user`, `paused`, `retrying`, `failed`, `completed`,
`cancelled`). They are orthogonal on purpose: a run can be waiting for the user
in any phase.

## Resumability

Every type here is JSON-serialisable by construction — no class instances, no
functions, no React state. An `AgentRun` can be written to storage and picked
up after the service worker is torn down. The runtime must be usable with no UI
attached at all; the side panel observes a run, it does not host one.

## The action vocabulary is the security boundary

`AgentAction` has four members: call a tool, ask the user, request review,
finish. There is no "run script", no "navigate", no "submit". Widening this
union is a security decision, not a feature decision.

`PHASE_TRANSITIONS` encodes the legal moves. Note that a failed verification
returns to `PLAN`, never straight back to `ACT` — a retry must be re-decided,
not repeated blindly.

## The reducer and the loop (Phase 2)

`reducer.ts` is the pure `(AgentState, AgentEvent) -> AgentState` function.
Its two safety rules — a terminal status is absorbing, and a phase only ever
moves through an edge `canTransition` allows — are what let a property test
throw thousands of random event sequences at it and never see an illegal
transition or an un-terminated terminal state.

`loop.ts` drives it, with every side effect (`ToolRegistry`, `PolicyEngine`,
`MemoryStore`, `ConceptIndex`, `Verifier`, the clock, id generation) injected
as `LoopPorts`. It is a `step`/`drive` pair rather than one long-running
async function on purpose: a run must survive the service worker being torn
down mid-`ask_user`, so `step` performs exactly one phase's work and returns
a new, JSON-serialisable `RunSnapshot` for the composition root to persist
(`chrome.storage.session`, via `~/lib/agent-runs`) and resume later — from a
fresh worker's `LoopPorts` if it comes to that, indistinguishably from
continuing in the same one.

No model exists yet (Phase 3), so `PLAN` is deterministic: it reuses 1c's
`resolve() -> memory -> policy.evaluate()` pipeline, restructured to decide
one field at a time. See `loop.ts`'s module doc for the full reasoning,
including why `ACT -> ACT` covers both a tool-execution retry and an
`ask_user`/`request_review` pause resolving into the actual write.
