# Phase 1c — Memory, the grant flow, and the first real fill

**Depends on:** 1a (extractor), 1b (matcher), and Phase 0 spike 1. **Unblocks:** 1d, 2.

> **Unblocked.** Spike 1 is answered: `permissions.request()` works from the side panel in
> Chrome 151, invoked from a trusted click. See
> [`docs/spikes-phase-0.md`](../spikes-phase-0.md), which also carries the caveat — the
> automated build may auto-accept prompts, so do **one manual click-through in a real Chrome
> window** before shipping the button, to confirm the bubble renders and "Allow" behaves.
>
> **This is the first phase that builds real UI.** Read the "Building UI" section of
> [`_context.md`](./_context.md) before you write a component: no design exists yet, nothing is
> hardcoded, compose from `src/components/ui/`, icons from `lucide-react`, marked placeholders
> over invented designs.

## Goal

Turn a resolved field into a value in a page, with the user's consent at every step this
product promises consent. That means four things that do not exist: somewhere to keep values,
a way to put values there in the first place, a reachable way to grant a site, and a
confirmation UI — because **nothing can auto-fill today**, so a fill without confirmation is
not a smaller version of this phase, it is a different product.

## Required reading

- [`_context.md`](./_context.md) first.
- The 1a and 1b handbacks.
- `src/core/memory/types.ts` and `store.ts` — the contract you implement.
- `src/lib/site-access.ts` — the whole file. It has no UI callers.
- `src/core/policy/default.ts` — read it and understand why everything asks.
- `docs/memory.md` — provenance, and "the model never writes".
- `wxt.config.ts` — the `build:manifestGenerated` hook, which you extend.

## Inline context

```ts
MemoryStore {
  get(key): Promise<MemoryItem | null>
  set(item): Promise<void>
  update(key, value): Promise<void>
  delete(key): Promise<void>
  search(query: MemoryQuery): Promise<MemoryItem[]>
}

MemoryItem { key, value, provenance, label? }
MemoryProvenance {
  source, confidence, createdAt, updatedAt, confirmedByUser,
  expiresAt?, freshnessRule?, evidence?
}
MemorySource = user_provided | user_confirmed | observed | inferred
```

`evidence` is a non-personal note about origin — a run id, an origin. **Never the value, never
the surrounding text.**

**Why everything asks:** `defaultPolicy` auto-allows only `public` sensitivity at `low` risk.
There are no `public` concepts. Every fill therefore returns `REQUIRE_CONFIRMATION`. This is
correct behaviour, not a bug to route around — see Traps.

## Deliverables

### 1. `InMemoryMemoryStore`

`src/core/memory/in-memory.ts`. Implements the real interface — `docs/memory.md` already
schedules it as implementation #1, and doing it properly now makes Phase 4's IndexedDB a swap
rather than a rewrite.

**Decide and record, because each is a migration if deferred:**

- **`schemaVersion` on `MemoryItem`**, and what the upgrade path looks like. Phase 4 needs it.
- **A subject dimension in the key space.** `identity.first_name` assumes one person. The
  Indian government-form use case routinely means filling on behalf of a spouse, a child or a
  parent. Either prefix keys with a profile id now, or accept single-subject forever and say so.
- **Where the store lives: the background service worker.** If it lives in the side panel it
  dies when the panel closes, and a run cannot outlive its observer. This makes the background
  worker the composition root — an architectural decision, not wiring.

**Tests:** yes, unit, thorough. Every method, plus `MemoryQuery` filtering by `keys`, `prefix`,
`text`, `minConfidence`, `sources`, `limit`. **Why:** it is pure, it is the contract every later
backend must satisfy, and this test suite is what makes the IndexedDB swap safe.

### 2. Onboarding

An ontology-driven "tell us about yourself" form in the side panel. ADR 005 says values are
typed once; for a new user memory is empty, every field becomes `ask_user`, and the extension is
worse than typing. Onboarding is what makes the first real fill possible at all.

Drive it from `concepts.json` — do not hand-write a form. Group by key prefix, label from the
concept, input type from `expects`, and respect `sensitivity` in how prominently a field is
presented. Adding a concept in 1b should add a field here with no code change.

That data-driven shape is also what makes the form survive a redesign: the mapping from
`expects` to a primitive in `src/components/ui/` is the only place presentation is decided, so
replacing the look is replacing primitives, not rewriting a form.

**Tests:** yes, one e2e asserting that a value entered in onboarding is retrievable from the
store and appears in a subsequent fill. **Why:** it is the seam between UI and domain; unit
tests on either side would both pass while the wiring is broken.

### 3. The write path — explicitly not through the tool registry

`docs/memory.md`: there is no `set_memory` tool and there will not be one. But `AgentAction` has
no memory-proposal member either, so "the model may propose a write" currently has **no
expressed path**. Close that gap here:

```
ask_user answer → side panel → application service → MemoryStore
```

Never `executeTool`. The application service is the only writer. Record the shape you chose.

**Tests:** yes — a test asserting the `MEMORY` capability domain contains exactly a known
read-only allowlist of tool names. **Why:** the shortcut here is a `memory.set` tool registered
"just for onboarding", which would put memory writes behind model-proposable actions forever.
The test makes that a CI failure rather than a code review someone is too busy for.

### 4. Make `site-access.ts` reachable and testable

- **Wire `requestSiteAccess` to a real button** in the side panel. It currently has zero UI
  callers — the runtime half of the privacy design is unreachable.
- **Fix the open-tab injection gap** confirmed in Phase 0 spike 2: `registerContentScripts`
  applies to subsequent navigations, so after granting, the user sees nothing until reload. Add
  the follow-up `scripting.executeScript` into the active tab.
- **Refactor for dependency injection.** The module imports `wxt/browser` at module scope, so
  the privacy-critical adapter has zero unit coverage. Take an injected `browser`-shaped
  dependency.
- **Show granted origins, and let the user revoke.** `revokeSiteAccess` exists and is unreachable.

**Tests:** yes, unit, against a fake `browser`. Cover: grant success, user declines (a normal
outcome — the caller degrades, it does not retry), `toOriginPattern` stripping paths and query
strings, revoke being idempotent, and `restoreGrantedSites` re-registering on startup.
**Why:** this is the mechanism the entire privacy claim rests on, and it currently has no test
at all.

### 5. The confirmation UI

The side panel shows what the agent proposes, per field: the concept, the value, where the
value came from (`provenance.source`), and the policy decision. The user confirms per field or
in bulk. Nothing enters the page before a confirmation.

Also render the three outcomes that are not "here is a value": `UNKNOWN` (ask), `AMBIGUOUS`
(offer the candidates from 1b), and `restricted` (always ask, even when confirmed before).

Those four states are the thing to get structurally right; how they *look* is a later decision.
Give each one a distinct component so a designer can restyle them independently, and use a
`lucide-react` icon per state rather than colour alone — colour meanings will change with the
design, and colour-only signalling fails for a chunk of users regardless.

**Tests:** covered by the e2e in the gate. No component tests. **Why:** the assertions that
matter are "nothing was filled before confirmation" and "restricted was not filled", and both
are only meaningful against a real page.

### 6. The messaging protocol

Phase 0 emptied `src/lib/messaging.ts`. Define the real protocol: side panel ↔ background ↔
content script. Keep it small and typed.

**One rule that must survive:** page writes are background-originated. Straight-line fills
must confirm a live, tab-bound pending decision after policy evaluation; the content script's
payload validation is the DOM-side backstop against malformed write messages.

**Tests:** yes, unit — assert malformed fill messages are rejected, plus background coverage
for tab-bound pending decisions. **Why:** policy must stay on the critical path rather than
beside it.

### 7. The e2e-only host permission

Playwright cannot click Chrome's native permission bubble. Extend the **existing** hook in
`wxt.config.ts` so one place still owns host permissions:

```ts
"build:manifestGenerated": (_wxt, manifest) => {
  delete manifest.host_permissions;
  if (process.env.WXT_E2E === "1") manifest.host_permissions = ["http://localhost:4173/*"];
}
```

`scripts/check-release-manifest.ts` from Phase 0 already fails on `localhost` in a release
manifest, so the flag cannot leak into a shipped build.

**Tests:** yes — confirm the release build still has no `host_permissions` and that the guard
script fails against a `WXT_E2E=1` build. **Why:** an e2e affordance that can reach production
is worse than no e2e.

## Gate

```bash
bun check
bun run build
bun test:e2e
```

New `e2e/fill.spec.ts`, against the `WXT_E2E=1` build:

- **Grant:** the panel's grant button → assert `getRegisteredContentScripts()` includes the
  origin (read via `worker.evaluate`).
- **Propose:** trigger a run on `/simple.html` → assert the panel shows N proposals and
  **0 fields have been filled**. This is the assertion that proves policy is on the path.
- **Confirm:** confirm → assert the values are in the page.
- **Untouched:** the `csrf` hidden field and the terms checkbox are not filled.
- **Restricted:** on `/messy.html`, the Aadhaar field is not filled and is reported as
  restricted — not merely skipped as unknown.
- **No grant, no run:** navigate to an ungranted origin → assert no shadow root, no messages.
- **Onboarding round trip:** a value typed in onboarding appears as a proposal on a later fill,
  with `provenance.source === "user_provided"`.

## Decisions to record in the handback

- `schemaVersion` shape and the intended upgrade path.
- Subject dimension: profile-prefixed keys, or single-subject.
- The messaging protocol, and the `decisionId` mechanism.
- The write-path service shape.
- What spike 2's fix actually required.

## Out of scope

No agent loop — Phase 2 owns the reducer, the loop and verification. Drive the fill from a
straight-line function here; Phase 2 replaces the driver, not the pieces. No IndexedDB. No
model. No files.

## Traps

- **"Just auto-fill the easy ones."** Nothing is `public`, so nothing auto-fills. If that feels
  wrong, the fix is a policy change with an ADR, not a special case in the panel.
- **A `memory.set` tool for onboarding.** Deliverable 3 exists to prevent exactly this.
- **Putting the store in the side panel** because that is where the UI is. It dies with the panel.
- **Skipping the DI refactor** on `site-access.ts` because it "already works". It has never
  been tested, and it is the file the privacy claim rests on.
- **Letting the panel message the content script directly** to get the demo working. That is
  the shortcut that makes policy decorative.
- **Filling the `csrf` field** because it is in the form. 1a's skip rules should have excluded
  it; if it reaches you, that is a 1a regression worth escalating.
- **Designing.** You are building surfaces that work and can be replaced, not surfaces that
  look finished. A hardcoded colour or spacing value now is a search-and-replace later.
