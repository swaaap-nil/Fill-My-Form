# Architecture decision records

One file per decision that constrains future work. Each records the context, the
decision, the alternatives that were real, and the consequences — including the
ones we do not like.

| ADR | Decision |
|---|---|
| [001](./001-single-package-over-monorepo.md) | Single package; boundaries enforced by lint, not by workspaces |
| [002](./002-llm-port-over-vercel-ai-sdk.md) | An `LLMProvider` port *over* the Vercel AI SDK, not instead of it |
| [003](./003-local-first-memory-boundary.md) | Personal memory is local-only, enforced by build failures |

Records for typed tools, progressive context disclosure and verification will be
written when those modules are built. The intended designs live in
[agent.md](../agent.md) meanwhile — an ADR for an unwritten module is a spec
wearing the wrong hat.
