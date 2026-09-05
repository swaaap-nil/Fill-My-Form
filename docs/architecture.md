# Architecture

## The one rule

Dependencies point inward. `src/core` is the domain; everything else depends on
it and it depends on nothing.

```
  src/app          WXT entrypoints (background, sidepanel, content, popup)
  src/components   React
        │
        ▼
  src/lib          Adapters: storage, messaging, auth, analytics, site access
        │
        ▼
  src/core         Domain. No React. No browser APIs. No cloud. No LLM SDK.
```

This is enforced, not encouraged. `biome.json` carries `noRestrictedImports`
overrides for `src/core/**`, so importing React, `#imports`, Supabase, OpenPanel
or a model SDK there fails `bun lint` and therefore CI. Each rule has a message
explaining itself at the point of failure.

Try it:

```bash
echo 'import { createClient } from "@supabase/supabase-js";' >> src/core/memory/store.ts
bun lint   # fails, with the reason
```

The payoff is concrete: the whole domain layer runs under `bun test` with no
DOM, no extension host and no network. That is why the test suite is fast enough
to run on every save.

## Why a single package

Extro is one package. A monorepo would add Bun workspaces, tsconfig references
and WXT reconfiguration to buy boundary enforcement we get more cheaply from
lint rules — and there is no second consumer yet. Module directories now,
extraction later if a `web` app appears. See
[ADR 001](./adr/001-single-package-over-monorepo.md).

## The domain modules

| Module | Owns |
|---|---|
| `form/` | FormIR: the normalised, DOM-free representation of a form |
| `ontology/` | Canonical concept keys and multilingual aliases, as data |
| `matching/` | Deterministic `FormField` -> candidate concept(s), and the eval harness that measures it |
| `journal/` | The local, unsent record of fields the matcher could not resolve |
| `memory/` | Personal memory types, the `MemoryStore` contract, the in-memory implementation, and the one write path (`write-service.ts`) |
| `fill/` | The straight-line fill driver: match -> memory lookup -> policy -> proposal |
| `messaging/` | The `decisionId`-gated fill-instruction schema, shared by background and content script |
| `agent/` | Phases, statuses, events, the legal transition table |
| `tools/` | Tool contracts, the registry, the validated execution path |
| `llm/` | The `LLMProvider` port, a mock, and one AI SDK adapter |
| `policy/` | What the runtime is willing to do automatically |
| `verification/` | Comparing intent against reality |

Each has a `README.md` stating its contract and what lands there next.

## Two representations, deliberately

`FormIR` carries **shape, not content**. A `FormField` says what a field is —
kind, label, constraints, options — and never what the user typed. `hasValue` is
the only signal about current content.

This matters because observations flow into agent context. If values rode along
in every observation, personal data would end up in prompts by default. Reading
a value back is instead a separate, authorised act performed by verification.

## Where the browser lives

Everything DOM-shaped is an adapter outside `src/core`:

- **Form extraction** → a content script produces a `FormIR`
- **Field interaction** → tools registered with a page adapter in their closure
- **Verification** → a `Verifier` implementation that reads the DOM back
- **Storage** → a `MemoryStore` implementation over IndexedDB

The pattern is the same each time: `src/core` declares the interface, `src/lib`
or an entrypoint implements it, and composition happens at the top.

## What is deliberately absent

No event bus. No dependency-injection container. No plugin system. No
abstraction with exactly one implementation and no second one planned. These get
added when a second case demands them, not in anticipation.

## Extension points

| To add | Do this |
|---|---|
| A tool | Register a `ToolDefinition`. The agent loop does not change. |
| An LLM provider | Implement `LLMProvider`. Business logic does not change. |
| An ontology concept | Append to `concepts.json`. No code changes. |
| A memory backend | Implement `MemoryStore`. |
| A matching tier | Add to `~/core/matching`'s cascade; `resolve()`'s candidate-set return shape does not change. (Corrected in phase 1b: `ConceptIndex.byAlias` returns a single optional `Concept` and cannot represent a tie, so a tier cannot live behind it — see `messy.html`'s `fld_7`.) |
| Semantic retrieval | Implement `MemoryQuery.text`; callers do not change. |
