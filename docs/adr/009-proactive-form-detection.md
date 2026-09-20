# 009 — Proactive form detection: optional all-sites grant, local notifications, no auto-fill

**Status:** accepted · 2026-09-20

## Context

The primary friction in the fill flow is remembering to open the side panel and
scan. Users who already store answers in local memory still have to invoke the
extension manually on every form.

The product still ships with **no host permissions at install time**. Site access
is requested at runtime from a user gesture. Phase 1c established per-origin grant
on scan; this ADR adds an optional **all http(s) sites** grant on first panel
open, with per-origin scan as the fallback when the user declines.

## Decision

### First-run gate (side panel)

On first open, the panel explains why broad access helps (forms can appear on any
site; detection runs without reopening the extension), that **matching and memory
stay on the device**, and that access is revocable. **Continue** calls
`permissions.request` for `https://*/*` and `http://*/*` from that click.
**Not now** records the choice and leaves the existing scan-owned per-origin
grant unchanged.

### Passive detection

On pages where the extension may run (global grant or per-origin grant), a
content script uses a **generic** DOM heuristic (forms and visible inputs — no
site-specific rules). When the heuristic fires, the background worker extracts
fields, runs the same `planFill` path as scan, and counts actionable proposals.

Detection **never writes to the page**. It may show a system notification with
**counts only** (no field values, labels, or URLs with query strings in the
notification body).

### Notifications

The `notifications` permission is used only to nudge the user. Clicking a
notification focuses the tab and opens the fill UI (side panel or Firefox
sidebar), then reuses `runFill` for proposals.

When a notification would fire, the extension may also show **counts-only**
supplementary nudges on the same detection: a **per-tab toolbar badge** and
an **in-page banner** on that tab (dismissible; opens the fill UI on explicit
click). These reuse the same dedupe rules as the OS notification and do not
add field values or URLs to the page overlay.

### Messaging contract

| Message | Direction | Payload |
|---------|-----------|---------|
| `formPageDetected` | content → background | `{ tabId, url, reason }` — heuristic metadata only |
| `getPageAccessForUrl` | content → background | `{ url }` → `{ mayDetect: boolean }` |
| `ackFormPageDetected` | background → content | `{ generation: string }` — dedupe generation ack |
| `showFormDetectionNudge` | background → content | `{ knownFieldCount, answerCount }` |
| `openFillUiFromTab` | content → background | opens fill UI from banner click (user gesture) |

Session storage may hold `pendingFillTabId` for deep-linking the side panel to a
tab, and `tab-fill-snapshot:{tabId}` for per-tab fill UI (proposals, scan
toolbar state, fill status) with the same **10-minute TTL** as pending fill
decisions. **My information** memory stays global in IndexedDB; only the panel
view is keyed by tab. Snapshots store proposal shapes and counts, not new cloud
data. When a snapshot exists, opening from a notification hydrates the panel
without a manual rescan; otherwise the panel falls back to auto-scan.

## Alternatives

**Install-time `<all_urls>`.** Rejected: contradicts the install-time privacy
claim and store differentiation.

**Auto-fill on detection.** Rejected: policy and confirmation review remain
mandatory; detection is a nudge only.

**Background alarms to poll tabs.** Rejected for freshness (ADR 006); detection
is page-event-driven via content scripts.

## Consequences

- Update `docs/privacy.md` and store listing: optional all-sites on first open;
  per-site fallback; notification behavior.
- `check-release-manifest.ts` requires `notifications`; still forbids install-time
  `host_permissions` and declarative all-urls `content_scripts`.
- Firefox may require badge + toolbar click when `sidebarAction.open()` lacks
  gesture from notification click; Chrome uses `sidePanel.open`.
