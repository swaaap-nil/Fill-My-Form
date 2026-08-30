# `llm/` — the provider port

Business logic depends on `LLMProvider`. It does not depend on a vendor.

```
agent -> LLMProvider -> AiSdkProvider -> chrome-ai | OpenAI-compatible | local
                     -> MockLLMProvider (tests, evaluation baselines)
```

`ai-sdk.ts` is the only file under `src/core` allowed to import a model SDK,
enforced in `biome.json`.

## Adding a provider

Implement `LLMProvider` in a new file and wire it at composition time. Nothing
in the agent changes. For anything OpenAI-compatible you probably do not need a
new provider at all — pass a different `LanguageModel` to `AiSdkProvider`.

## Two deliberate details

**Tools are declared to the SDK without an `execute` function.** The model may
propose a call; the SDK cannot run it. Execution stays with our registry,
behind schema validation and policy.

**Structured output is validated twice** — by the SDK, then by us. The model is
untrusted input all the way to the last boundary.

See `docs/adr/002-llm-port-over-vercel-ai-sdk.md`.
