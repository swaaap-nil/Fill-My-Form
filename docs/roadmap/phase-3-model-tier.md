# Phase 3 — The model tier, earned

**Depends on:** 1b (the numbers), 2 (the loop). **Unblocks:** 6.

> **Outline, not a finished brief.** Expand this using 1b's actual coverage figures before
> handing it over. Specifying a model tier before the eval exists is a guess.

## Goal

Resolve what the deterministic tiers could not — and only that.

**This phase may not happen at all.** If 1b's residual is small, the right move is more aliases
and more concepts, which are cheaper, faster and cannot hallucinate. The suggested bar is >15%
of in-scope fields left `UNKNOWN` or `AMBIGUOUS`, but 1b's handback carries a recommendation
from whoever has actually seen the numbers. Read it first.

## Required reading

- [`_context.md`](./_context.md) first.
- **1b's handback** — the coverage table is the entire justification for this phase.
- `src/core/llm/provider.ts`, `mock.ts`, `ai-sdk.ts` — the port already exists and works.
- `docs/adr/002-llm-port-over-vercel-ai-sdk.md`.
- `docs/agent.md` — "Progressive disclosure of context". This is the section this phase is
  most likely to violate.

## Shape of the work

Re-add exactly one model SDK, imported only by `src/core/llm/ai-sdk.ts` — the one file
`biome.json` permits it in. Phase 0 removed `ai` and `chrome-ai` deliberately so that this
re-addition is a visible, reviewable act.

The model's job is narrow: given a `FieldSummary` or `FormField` that the deterministic tiers
could not resolve, **emit a canonical ontology concept key**. Not a value. Not free text. The
engine resolves the key to a value through the same memory path everything else uses, so a
model failure is a wrong *mapping* the user can see and reject, never an invented value.

Tools are declared to the SDK without an `execute` function — the model may propose a call, the
SDK cannot run it. Structured output is validated twice, by the SDK and again by us. Both are
existing behaviour in `ai-sdk.ts`; do not undo them.

## The trap this phase exists to avoid

The temptation for `messy.html`'s `fld_7` is to hand the model the surrounding page text.
`docs/agent.md` says the DOM is never sent to a model. A field the agent never asks about must
never enter a prompt.

Make prompt construction a **pure function in `src/core`** taking `FieldSummary[]` / `FormField`
and nothing else. Then it is testable under `bun test` and the constraint is structural rather
than remembered.

## Testing decisions

| Deliverable | Tests | Why |
|---|---|---|
| Prompt construction | **Yes, unit.** Build a `FormIR` containing a sentinel string in a field the model should not see; assert the assembled prompt does not contain it. | This is the phase's central risk, and it is cheap to make mechanical. |
| Concept-key output | **Yes, unit,** via `MockLLMProvider`. Assert an unknown or malformed key is rejected rather than passed through. | The model is untrusted input all the way to the last boundary. |
| Coverage improvement | **Yes** — the 1b eval harness, re-run. | The phase's justification is a number; prove the number moved. |
| Live model calls | **No.** Every test runs through `MockLLMProvider`. | CI must never need a network or a key. |

## Gate

- Eval coverage improves measurably against 1b's baseline.
- **`resolved_wrong` is still exactly 0.** A model tier that raises coverage by raising wrong
  fills has made the product worse.
- The prompt sentinel test passes.
- Every test still passes with `MockLLMProvider`; CI makes no network call.

## Out of scope

The model does not write memory, does not choose to submit, and does not receive page text.
Semantic retrieval over memory is a separate, later question — `MemoryQuery.text` is the seam,
and `docs/memory.md` is explicit that embeddings arrive only against a measured number.

## Escalate if

- The residual cannot be fixed without sending page text. That is an ADR-level conversation,
  not a prompt-engineering decision.
- You want a second model call per field. Cost and latency are product decisions.
