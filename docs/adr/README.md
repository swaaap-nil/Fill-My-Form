# Architecture decision records

One file per decision that constrains future work. Each records the context, the
decision, the alternatives that were real, and the consequences — including the
ones we do not like.

| ADR | Decision |
|---|---|
| [001](./001-single-package-over-monorepo.md) | Single package; boundaries enforced by lint, not by workspaces |
| [002](./002-llm-port-over-vercel-ai-sdk.md) | An `LLMProvider` port *over* the Vercel AI SDK, not instead of it |
| [003](./003-local-first-memory-boundary.md) | Personal memory is local-only, enforced by build failures |
| [004](./004-hand-rolled-state-machine.md) | A hand-rolled reducer and loop, not LangGraph or an agent framework |
| [005](./005-no-document-content-reading.md) | Nothing reads the inside of a user's file — no OCR, no vision, on-device or otherwise |
| [006](./006-value-freshness-and-expiry.md) | Every value has a freshness horizon; expiry asks rather than deletes |
| [007](./007-shared-site-knowledge.md) | Site knowledge is contributed anonymously, corroborated across devices, and received only as a hint |
| [008](./008-image-metadata-writing.md) | Image density headers are read and written by hand, in-repo — container metadata, not document content |

Records for typed tools, progressive context disclosure and verification will be
written when those modules are built. The intended designs live in
[agent.md](../agent.md) meanwhile — an ADR for an unwritten module is a spec
wearing the wrong hat.
