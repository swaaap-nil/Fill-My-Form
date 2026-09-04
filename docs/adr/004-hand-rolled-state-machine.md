# 004 — A hand-rolled state machine, not an agent framework

**Status:** accepted · 2026-09-04

## Context

`agent/types.ts` has the phases, the statuses and the legal transition table.
What is missing is the reducer (`AgentState + AgentEvent → AgentState`) and the
loop that drives it. That gap is exactly the shape an agent framework offers to
fill, and LangGraph is the obvious candidate.

The pull is real: checkpointing, human-in-the-loop interrupts, retries and
multi-step tool loops are all things we will need, and all things a framework
claims to have solved.

## Decision

Write the reducer and the loop ourselves. No LangGraph, no agent framework.

Three properties of *this* product make the framework a bad trade:

**The state space is small and closed.** Seven phases, one loop-back edge on
failed verification, and a status axis that is orthogonal to all of it. That is
a lookup table and a switch, not a graph engine. `AgentAction` has four members
and widening it is a security decision — a general-purpose orchestration
library is built to make exactly that widening easy.

**MV3 is a hostile host for a framework's persistence model.** The runtime lives
in a service worker that Chrome tears down without warning, and a run must
survive that. Framework checkpointers assume a durable backend — Postgres,
SQLite, Redis. Adapting one to IndexedDB inside a worker means writing the
checkpointer anyway, at which point the framework has been paid for and not
used.

**Auditability is the product.** The claim is "this extension cannot do anything
but fill forms." That claim is only as strong as the reader's ability to check
it, and every dependency in the control-flow path is code a reviewer must also
read. A dependency tree is a poor place to keep a security boundary.

## Alternatives

**LangGraph JS.** Best-known option, real ecosystem, tracing via LangSmith. Costs
a large dependency in the hot path, a persistence model that fights the host, and
a control flow expressed in someone else's vocabulary. Buys most of its value on
problems — dynamic replanning, subagents, wide tool branching — that we have
deliberately designed out.

**XState.** The honest middle. A proper state-machine library, serialisable
machine definitions, good tooling, far lighter than an agent framework. Rejected
narrowly: our transition table is already written and already tested, and
`canTransition` is nine lines. XState would replace nine lines of ours with a
dependency and a DSL. If the machine grows hierarchical or parallel states, this
is the first thing to reconsider.

**No machine at all** — an async function with awaits and a `while` loop. This is
what most agent code actually is. Rejected because a run must be inspectable and
resumable with no UI attached: a suspended call stack cannot be written to
IndexedDB, and a JSON state object can.

## Consequences

Good:

- The whole control flow is ours, in `src/core`, under `bun test`, with no DOM,
  no host and no network. Resumability falls out of the state being plain JSON
  rather than being a feature we configure.
- Adding a phase or an edge is a change to a table plus a test, and the security
  review of "what can the agent do" stays a review of one union type.

Bad:

- Streaming, retries with backoff, and interrupt/resume semantics are ours to
  write and ours to get wrong. Frameworks have these because they are fiddly.
- No off-the-shelf tracing UI. Observability is our own event log, which is
  probably right anyway given that traces of this agent contain personal data
  and must not leave the device.

## When to revisit

If the machine grows hierarchical or parallel states, or if a genuine multi-agent
topology appears (one run coordinating several independent sub-runs). At that
point XState is the first candidate, and a full agent framework only if control
flow has become genuinely dynamic — which would itself be worth questioning,
because it would mean the closed action vocabulary had already been widened.
