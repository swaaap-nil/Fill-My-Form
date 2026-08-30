# 002 — An LLM port over the Vercel AI SDK, not instead of it

**Status:** accepted · 2026-08-30

## Context

The brief requires that the application not depend on a particular LLM vendor,
and that business logic never import a model SDK directly:

> Bad: `import OpenAI from "openai"` inside the agent.

Extro already ships the Vercel AI SDK (`ai@4.3`) and `chrome-ai`, with a working
chat tab. The AI SDK is itself a vendor abstraction: one interface over OpenAI,
Anthropic, Google, local and OpenAI-compatible endpoints.

So the vendor-independence requirement was already partly met, and the open
question was how our own port should relate to a library that overlaps it.

## Decision

Define a narrow `LLMProvider` port in `src/core/llm/provider.ts` and implement it
twice: `MockLLMProvider` for tests, and `AiSdkProvider` delegating to the AI SDK.

`ai-sdk.ts` is the only file under `src/core` permitted to import a model SDK,
enforced in `biome.json`.

Two details are deliberate:

**Tools are declared to the SDK without an `execute` function.** The model may
propose a call; the SDK cannot run it. Execution stays with our registry, behind
schema validation and policy.

**Structured output is validated twice** — by the SDK, then by us. The model is
untrusted input all the way to the last boundary.

Schemas cross the boundary as JSON Schema via `z.toJSONSchema`, sidestepping the
Zod 3/4 mismatch between our Zod 4 and the SDK's expectations.

## Alternatives

**Our own interface, drop the AI SDK.** Maximum independence. Requires
reimplementing streaming, tool-call parsing, structured-output coercion and
provider quirks — the parts that are tedious and easy to get subtly wrong. Pays a
large cost for independence from a library that is itself an independence layer.

**Use the AI SDK directly, no port.** Fewer layers. But `generateText` appears
throughout the agent, the SDK's types become our domain types, and the "no SDK in
business logic" rule is lost. Migrating off the SDK would then touch every call
site.

**Port with no real adapter yet.** Ship only the interface and the mock. Honest
about the current state, but leaves the port unproven: an abstraction with one
fake implementation has not been tested against reality.

## Consequences

Good:

- Business logic depends on `LLMProvider`. Swapping vendors is a `LanguageModel`
  argument; adding a genuinely different backend (WebLLM, a local server) is one
  new file.
- `MockLLMProvider` makes the whole agent testable offline and deterministically,
  which is also what makes evaluation runs reproducible.
- Structured output, tool descriptors and usage accounting have one shape across
  every provider.

Bad:

- Two layers of indirection to reach a model. Accepted: the port is about twenty
  lines of types.
- The port must express what the SDK can do without leaking its types. Where they
  diverge — streaming, multi-step tool loops — the port will need extending
  rather than bypassing. Streaming in particular is not in the port yet and will
  need a deliberate addition.
- `z.toJSONSchema` at the boundary loses Zod refinements the SDK cannot express.
  Our own `safeParse` on the result catches what slips through.

## When to revisit

If the SDK's provider coverage stops matching what we need, or if streaming and
multi-step tool use force the port to grow into a parallel reimplementation. At
that point the honest options are to depend on the SDK directly or to replace it,
not to keep a port that has become a copy.
