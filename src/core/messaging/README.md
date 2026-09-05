# `messaging/` — the one rule that keeps policy load-bearing

`fillFieldPayloadSchema` / `assertValidFillInstruction` are the whole module:
a fill instruction the content script accepts must carry a `decisionId` the
background minted after actually running `PolicyEngine.evaluate` for that
field. Without this, the side panel could message the content script
directly and policy would be advisory rather than on the critical path.

Pure and DOM-free on purpose — no browser, no `MemoryStore`, no messaging
library — so the property is unit-tested in isolation
(`src/core/tests/fill-instruction.test.ts`) and cannot regress silently
behind a browser-only integration test. `~/lib/messaging` re-exports this for
the wire protocol; nothing else in the codebase constructs a `decisionId`.

## What lands here next

Nothing planned. This module is deliberately small and stays that way.
