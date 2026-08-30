# `src/core` — the domain layer

Everything the product *means*, with none of the machinery it runs on.

No file here imports React, `#imports` (WXT/browser APIs), Supabase, OpenPanel,
or a model SDK. That is enforced by `noRestrictedImports` overrides in
`biome.json`, so a violation fails `bun lint` and CI — it is not a convention
anyone has to remember. The payoff: this layer runs in plain Bun, which is why
`bun test` needs no DOM, no extension host and no network.

The browser lives on the other side of the boundary, in `src/lib` and
`src/app`. Adapters there translate between the DOM and the types defined here.

| Module | Owns | Does not own |
|---|---|---|
| `form/` | The FormIR: what a form and its fields *are* | Detecting them (that reads the DOM, so it is an adapter) |
| `ontology/` | Canonical concept keys and their aliases, as data | Matching strategy beyond exact alias lookup |
| `memory/` | Personal memory types and the `MemoryStore` contract | Any implementation; storage; embeddings |
| `agent/` | Phases, statuses, events, the transition table | Running the loop; prompts |
| `tools/` | Tool contracts, the registry, the validated execution path | What any individual tool does |
| `llm/` | The `LLMProvider` port, mock, and AI SDK adapter | Prompt content; which model is used |
| `policy/` | What the runtime is willing to do automatically | Asking the user (that is a tool) |
| `verification/` | Comparing intent against reality | Reading the DOM back |
| `errors.ts` | The error taxonomy | |
| `logging.ts` | Structured logging with a closed field allowlist | Shipping logs anywhere |

## The two rules worth internalising

**The model is untrusted input.** It proposes; the runtime disposes. Model
output is parsed before use, never executed, and never rendered as HTML.

**Never guess.** `Certainty` in `agent/types.ts` has four values —
`known`, `unknown`, `ambiguous`, `requires_confirmation` — and no fifth one
meaning "invented something plausible".
