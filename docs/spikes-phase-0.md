# Phase 0 spikes

Three questions the roadmap needed answered before Phase 1c could be written.
Code from these spikes does not land here — only the answers do.

## 1. Does `chrome.permissions.request()` work from the side panel?

**Yes, in Chrome 151.0.7922.34 (the `chromium` channel Playwright drives).**
Calling `chrome.permissions.request({ origins: [...] })` from `sidepanel.html`,
triggered by a trusted click event (a Playwright-dispatched click, which Chrome
treats as a genuine user gesture), did not throw synchronously and did not
silently resolve `false`. It stayed pending — consistent with a native
permission prompt being shown — then resolved `true`.

**Caveat:** the automated Chrome-for-Testing build used for this spike may
auto-accept permission prompts under automation, so this does not confirm what
the *visible* prompt looks like or that a human clicking "Allow" behaves
identically. It does confirm the call is accepted and completes when invoked
from the side panel — the failure mode this spike was checking for (some
Chrome versions silently reject `permissions.request()` outside a popup) was
**not observed**.

**Recommendation:** before Phase 1c ships the real button, do one manual
click-through in an actual (non-automated) Chrome window to see the bubble
render and confirm "Allow" behaves as expected. Nothing found here blocks
starting Phase 1c on the assumption that the API works from the panel.

## 2. The open-tab injection gap

Confirmed, and already recorded in [`_context.md`](./roadmap/_context.md):
`registerContentScripts` (called from `requestSiteAccess` in
`src/lib/site-access.ts`) only affects **subsequent** navigations. After a
grant, the currently open tab shows nothing until the user reloads it.

**The fix**, for Phase 1c: after `registerContentScripts` succeeds, also call
`chrome.scripting.executeScript` directly into the active tab (the one the
grant was requested for), so the content script appears immediately without
requiring a reload. This is a second, one-off injection alongside the
runtime registration — the registration covers future navigations, the direct
`executeScript` covers the tab that's open right now.

## 3. Firefox MV3 target

Confirmed feasible. Setting `manifestVersion: 3` in `wxt.config.ts` (tested
temporarily, not committed — that's Phase 5's job) and building
`wxt -b firefox zip` produces `build/firefox-mv3/manifest.json` with:

- `host_permissions`: **absent** — the `build:manifestGenerated` hook in
  `wxt.config.ts` strips WXT's inferred `host_permissions` on the Firefox
  target exactly as it does on Chrome. No target-specific fix needed.
- `optional_host_permissions`: **present**, unchanged
  (`["https://*/*", "http://*/*"]`) — the runtime grant flow's upper bound
  survives.
- `sidebar_action` in place of `side_panel` (Firefox's sidebar API), and
  `background.scripts` in place of `background.service_worker` — both handled
  automatically by WXT's per-browser manifest generation, not something Phase
  5 needs to special-case.

No blocker found. Phase 5 can proceed on the assumption that the manifest hook
needs no Firefox-specific change.
