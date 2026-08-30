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

## What lands here next

The reducer (`AgentState` + `AgentEvent` -> `AgentState`) and the loop that
drives it. Both pure and UI-free.
