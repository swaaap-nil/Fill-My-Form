# `memory/` — personal memory

**Local-only.** `biome.json` forbids this directory from importing any network,
cloud or model client. The guarantee is mechanical, not aspirational: adding
such an import fails `bun lint`.

## Provenance is mandatory

Every `MemoryItem` carries a `MemoryProvenance`: where the value came from, how
confident we are, and whether the user has confirmed this exact value. That is
what lets policy distinguish "the user typed this" from "we inferred it", and
it is why `MemorySource.INFERRED` values always require confirmation.

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
