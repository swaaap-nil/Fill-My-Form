# Phase 4 — IndexedDB, freshness, export and wipe

**Depends on:** 2. **Unblocks:** 5, 6.

> **Outline, not a finished brief.** Expand using 1c's recorded decisions on `schemaVersion`
> and the subject dimension before handing it over.

## Goal

Make memory durable, make stale values ask instead of lying, and let the user leave with their
data or destroy it.

## Required reading

- [`_context.md`](./_context.md) first.
- **1c's handback** — `schemaVersion`, the subject dimension, and the store's location.
- `docs/adr/006-value-freshness-and-expiry.md` — the whole thing. This phase implements it.
- `docs/memory.md` — the freshness section.
- `src/core/ontology/types.ts` — the `Volatility` union.

## Shape of the work

**The store swap.** Replace `InMemoryMemoryStore` with an IndexedDB implementation behind the
same `MemoryStore` interface. 1c's unit suite is what makes this safe — the new backend must
pass the same tests unchanged. If it cannot, the interface was wrong and that is worth
escalating rather than special-casing.

`chrome.storage` is not an option: `docs/memory.md` rules it out on size and structure grounds.

**Freshness.** `freshness(item, now): "fresh" | "expiring_soon" | "due"` — a pure function in
`src/core`, with `now` injected rather than read from `Date.now()`. Evaluated on read during
RETRIEVE, never by a background sweep.

A stale value lowers effective confidence, policy returns `REQUIRE_CONFIRMATION`, and the user
gets a yes/no on the value already held — "Still at Kirloskar Systems?", not an empty box.
Confirming sets `expiresAt` to `now + ttl`, computed from the confirmation rather than from the
old horizon.

The duration table is separate from `concepts.json` and tunable; ship a bundled default so a
device that never reaches the network keeps working.

**At rest.** No encryption — IndexedDB stores plaintext and `docs/privacy.md` gains a section
saying at-rest protection is the operating system's job. Do not add a passphrase flow; that was
decided.

**Export and wipe.** A local-first product must let users take their data and destroy it. It is
also a store-review asset and a genuine differentiator.

Both need UI. Follow the "Building UI" rules in [`_context.md`](./_context.md) — compose from
`src/components/ui/`, `lucide-react` for icons, nothing hardcoded. Wipe is destructive and
irreversible, so it needs a real confirmation step rather than a single button; that much is a
behaviour requirement, not a design decision, and it stays true whatever the eventual design
looks like.

## Testing decisions

| Deliverable | Tests | Why |
|---|---|---|
| IndexedDB store | **Yes** — re-run 1c's entire `MemoryStore` suite against it, unchanged. | The interface is the contract; a backend that needs different tests is a different interface. |
| `freshness()` | **Yes, unit, table-driven** over all five `Volatility` classes, with injected `now`. Include ADR 006's stated consequence: an unknown volatility class falls back to the **most conservative** duration, not to `permanent`. | Pure, total, and the whole point of ADR 006. |
| Migration | **Yes, unit.** An item written before this phase has no `expiresAt`; assert it is derived on next read rather than treated as permanent. | Silent data rot, and it only appears for existing users — never in a fresh install. |
| Confirmation refresh | **Yes, unit.** Confirming sets the horizon from `now`, not from the previous `expiresAt`. | Off-by-one here means values slowly drift stale. |
| Export / wipe | **Yes, e2e.** Export, wipe, re-import, assert the store matches. **Wipe must also clear Phase 1b's field journal**, and the export must include it — assert both. | It is the user's exit, and a wipe that leaves residue is a privacy failure. The journal is the residue most likely to be forgotten, because it is not "memory". |
| No background sweep | **Yes** — assert `alarms` is absent from the manifest. | ADR 006 forbids it and the shortcut is one line. Phase 0's manifest check already covers this; confirm it still fires. |

## Gate

```bash
bun check && bun run build && bun test:e2e
```

- 1c's memory suite passes unchanged against IndexedDB.
- A value past its horizon produces a confirmation prompt rather than a silent fill.
- Confirming refreshes the horizon; the value is never deleted.
- Export → wipe → import round-trips.
- `alarms` is absent from both manifests.

## Out of scope

No sync, no cloud backup, no encryption. A remote-backed store is explicitly not planned —
`docs/memory.md` says it would arrive as a separately consented feature with its own ADR, not
as an adapter swapped in behind the interface.

## Escalate if

- The `MemoryStore` interface cannot express what IndexedDB needs.
- The duration defaults produce a confirmation treadmill in manual use. ADR 006 already flags
  the durations as guesses that must be tuned against real confirmation-rate data.
