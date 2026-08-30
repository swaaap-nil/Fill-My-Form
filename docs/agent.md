# The agent

Not an autonomous loop. An explicit state machine that the runtime drives and
the model advises.

```
OBSERVE → UNDERSTAND → RETRIEVE → PLAN → ACT → VERIFY → DONE
                                    ↑             │
                                    └─────────────┘
                                   failed verification
```

`AgentPhase` is where the run is. `AgentStatus` is whether it is moving, and if
not why: `waiting_for_user`, `paused`, `retrying`, `failed`, `completed`,
`cancelled`. They are orthogonal — a run can be waiting for the user in any
phase.

A failed verification returns to `PLAN`, never straight back to `ACT`. A retry
must be re-decided, not repeated blindly; `canTransition` encodes that and a
test asserts it.

## Resumable by construction

Every type in `agent/types.ts` is JSON-serialisable: no class instances, no
functions, no React state. An `AgentRun` can be written to storage and resumed
after the service worker is torn down.

The runtime lives in the background worker, which outlives any side panel. The
panel **observes** a run; it does not host one. Closing the panel must not kill
a run, and a run must be inspectable with no UI attached at all.

## Progressive disclosure of tools

The model does not receive every tool at every step. `ToolRegistry.describe()`
takes the capability domains relevant to the current phase, and there is
deliberately no "list everything" for prompt construction.

| Phase | Domains | Typical tools |
|---|---|---|
| Form inspection | `browser` | `inspect_form`, `inspect_field_context` |
| Memory retrieval | `memory` | `search_memory`, `get_memory` |
| Filling | `browser` | `type`, `select`, `check` |
| Upload | `files`, `browser` | `find_asset`, `validate_file`, `upload` |
| Confirmation | `user` | `ask_user`, `request_confirmation`, `show_review` |

Upload tools are invisible when the form has no file field. Destructive tools
are not registered at all until there is a reason.

## Progressive disclosure of context

The page DOM is never sent to a model. The agent starts with the cheapest useful
observation and asks for more:

```
page metadata + form metadata + field summaries
        ↓ reason
inspect_field_context(fieldId)  ← only for fields it cannot resolve
inspect_options(fieldId)        ← only when it needs the option list
        ↓ reason
act
```

`FieldSummary` is the cheap projection; `FormField` is the full picture, fetched
per field. This cuts tokens, latency and — the reason it is architectural rather
than an optimisation — privacy exposure. A field the agent never asks about
never enters a prompt.

## Deterministic first

The model is the last resort, not the first:

```
Deterministic rules      ← autocomplete attributes, input types
Known mappings           ← per-site mappings, once we have them
Keyword / alias matching ← ontology aliases, exact and normalised
Semantic retrieval       ← later
Small LLM
Larger LLM
```

The alias tier already works with no model involved: `ontology.byAlias("10th
Passing Year")` resolves to `education.secondary.completion_year`, and a test
asserts it. Every tier that resolves a field is a tier that costs nothing and
cannot hallucinate.

## Never guess

`Certainty` has four values — `known`, `unknown`, `ambiguous`,
`requires_confirmation` — and no fifth meaning "invented something plausible".
An unresolved field becomes a question for the user, not a confident-sounding
fabrication. `test-site/messy.html` contains a bare "Year" field precisely to
exercise `ambiguous`.

## The action vocabulary is the security boundary

`AgentAction` has four members: call a tool, ask the user, request review,
finish. There is no "run script", no "navigate", no "submit". Widening this
union is a security decision, not a feature decision.

## The trust pipeline

```
model proposes
   ↓  schema validation      (Zod, against the tool's input schema)
   ↓  policy check           (PolicyEngine.evaluate)
   ↓  execution              (our code, with capabilities granted at wiring)
   ↓  result validation      (Zod, against the tool's output schema)
   ↓  verification           (read the DOM back, compare to intent)
agent observes
```

Results are validated too: a misbehaving adapter must not be able to widen what
the agent believes it received. Every stage can reject, and rejection is a normal
outcome fed back as an observation, not an exception that unwinds the run.

## What is not built yet

The reducer (`AgentState` + `AgentEvent` → `AgentState`) and the loop that drives
it. Both will be pure and UI-free. The types, the transition table and the
tool-execution path are in place; the orchestration is not.
