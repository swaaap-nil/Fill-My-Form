# Phase 5 — Firefox on MV3

**Depends on:** 4, and Phase 0 spike 3. **Unblocks:** 6.

> **Outline, not a finished brief.** Expand using spike 3's findings.

## Goal

Make Firefox a real target rather than a build script nobody has run.

## Required reading

- [`_context.md`](./_context.md) first.
- Phase 0 spike 3's findings.
- `wxt.config.ts` — the `build:manifestGenerated` hook.
- `src/lib/site-access.ts` — the API surface that differs across browsers.

## Why this is a phase and not a build flag

The current Firefox MV2 output is not merely stale — it is structurally incompatible with the
product's privacy design:

- **No `optional_permissions` key at all.** `optional_host_permissions` is MV3-only and WXT
  emitted no MV2 equivalent, so `browser.permissions.request({ origins })` rejects. The entire
  runtime site-access mechanism — the core of the privacy model — is inert on that build.
- `"sidePanel"` appears in `permissions`, which is not a valid Firefox permission; AMO's linter
  flags unknown permissions.
- `browser_action.default_popup` points at `popup.html`, deleted in commit `a7b6434`. A missing
  file is an AMO error.
- No `browser_specific_settings.gecko.id`, which `wxt submit` needs.
- `browser.scripting.registerContentScripts` availability under Firefox MV2 is uncertain; the
  MV2 path is `browser.contentScripts.register`, a different API with a different lifetime.

**The decision was MV3.** Firefox 109+ supports it, AMO accepts it, `optional_host_permissions`
exists, and Firefox MV3 treats host permissions as opt-in by default — which is exactly this
product's model. Maintaining two different site-access mechanisms for a design whose whole point
is the grant flow would be the worst outcome.

## Shape of the work

Set `manifestVersion: 3` for the Firefox target. Add `browser_specific_settings.gecko.id` and a
minimum Gecko version. Confirm the `build:manifestGenerated` hook strips inferred
`host_permissions` on that target too — it was written with the Chrome build in mind.

Firefox uses `sidebar_action` rather than `side_panel`. Establish whether WXT maps this, or
whether the panel entrypoint needs a target-conditional manifest block.

Delete the stale `build/firefox-mv2/` output so nobody reasons from it again.

## Testing decisions

| Deliverable | Tests | Why |
|---|---|---|
| The Firefox manifest | **Yes** — extend `scripts/check-release-manifest.ts` to check both targets, not just Chrome. | The Chrome-only check is why the Firefox build drifted unnoticed. |
| The fill flow | **Yes** — run 1c's `e2e/fill.spec.ts` against the Firefox build. | An untested browser target is an unsupported one, and claiming Firefox support in a listing you have not exercised is how one-star reviews start. |
| `site-access.ts` on Firefox | **Yes** — its 1c unit tests re-run against a Firefox-shaped fake `browser`. | This is the API most likely to differ. |
| Sidebar rendering | **Covered by the fill spec.** No separate test. | If the panel does not render, the fill spec fails first and more informatively. |

Playwright's Firefox support for extensions is more limited than Chromium's. If the fill spec
cannot run there, say so explicitly and document the manual verification you did instead —
do not quietly mark the phase done on the Chrome result.

## Gate

```bash
bun run build:firefox
```

- Firefox manifest is MV3, carries `optional_host_permissions`, no `host_permissions`, no
  invalid permissions, and a valid `gecko.id`.
- `permissions.request({ origins })` actually works — verified manually if not automatable.
- The 1c fill flow works end to end on Firefox.
- The manifest guard runs against both targets.

## Escalate if

- Firefox MV3 cannot deliver the per-origin grant. That would mean either dropping Firefox from
  v1 or accepting a materially different privacy story there, and both are product decisions.
