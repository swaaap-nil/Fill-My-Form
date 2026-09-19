# Architecture

## The one rule

Dependencies point inward. `src/core` is the domain; everything else depends on
it and it depends on nothing.

```
  src/app          WXT entrypoints (background, sidepanel, content, editor, options)
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
| `memory/` | Personal memory types, the `MemoryStore` contract, implementations, local restore, and the user-answer write path (`write-service.ts`) |
| `fill/` | The straight-line fill driver: match -> memory lookup -> policy -> proposal |
| `messaging/` | Typed panel/background/content messages and DOM-write payload validation |
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

### The image editor is its own window

`src/app/editor` is a second user-facing surface, and it exists for a reason
worth writing down: **Chrome renders the side panel inside a frame it controls,
so nothing the panel draws can escape it.** A modal there is still a few hundred
pixels wide, which is no use for framing a photo. The editor is therefore a
separate extension window (`windows.create({ type: "popup" })`), sized properly.
It needs no new permission — `chrome.windows` requires none.

Two documents then have to agree on what is being edited and what came back:

- **Only identifiers cross.** The original is already in the shared
  `form-agent-files` IndexedDB and both documents are the same extension
  origin, so the handshake carries its id. A blob URL would not work — those are
  scoped to the document that created them.
- **The rendezvous is `chrome.storage.session`, not messaging.**
  `runtime.sendMessage` is point-to-point and rejects when no receiver exists,
  and there is no receiver exactly when it matters: the side panel closes as
  soon as the user clicks the editor window, which is the first thing opening it
  asks them to do. A result posted to a closed panel would vanish. Storage has
  the right lifetime, and `onChanged` fires in every context — including a panel
  that opens *after* the write, so the live path and the reconcile-on-mount path
  are one piece of code.
- **The rules are in core.** `src/core/files/editor-session.ts` holds the status
  machine and staleness; `src/lib/files/editor-session.ts` is the storage
  adapter. Same split as `agent-runs`.

A window that is closed with the X still has to settle its session. The editor
writes `cancelled` on `pagehide` as a best effort, but the guarantee is the
panel's `windows.onRemoved` listener, with an age backstop for when the panel
was closed too.

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
