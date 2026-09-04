# `memory/` — personal memory

**Local-only.** `biome.json` forbids this directory from importing any network,
cloud or model client. The guarantee is mechanical, not aspirational: adding
such an import fails `bun lint`.

## Provenance is mandatory

Every `MemoryItem` carries a `MemoryProvenance`: where the value came from, how
confident we are, and whether the user has confirmed this exact value. That is
what lets policy distinguish "the user typed this" from "we inferred it", and
it is why `MemorySource.INFERRED` values always require confirmation.

## Values expire into a question, not into a hole

`expiresAt` is optional; absent means the value does not go stale. When the
horizon passes, effective confidence drops, policy asks for confirmation, and the
user answers yes/no on the value we already hold. Nothing is deleted and nothing
is withheld. The horizon comes from the concept's `volatility` and a separately
tunable duration table; freshness itself is a pure function of an item and an
injected `now`, evaluated on read. See
[ADR 006](../../../docs/adr/006-value-freshness-and-expiry.md).

## Files are referenced, never read

A file-typed concept stores a *reference* to a file the user tagged once. There
is no tool that reads file content — no OCR, no vision model, on-device or
otherwise — so a document-derived value like a passport number is always typed by
the user rather than extracted. See
[ADR 005](../../../docs/adr/005-no-document-content-reading.md).

## The model never writes here

There is no `set_memory` tool. The model may *propose* a write; the write
happens through an application service, after policy evaluation and — where
required — user confirmation. Keeping mutation out of the tool surface means a
prompt injection cannot corrupt the user's memory.

## Implementation order

1. In-memory — tests.
2. IndexedDB — production.

A remote-backed store is deliberately not planned. If one is ever needed it
becomes an explicit, separately-consented feature with its own ADR, not a
swapped-in adapter.

## What lands here next

The in-memory store, then the IndexedDB one. `MemoryQuery.text` is the seam
where semantic retrieval slots in later without changing any caller.
