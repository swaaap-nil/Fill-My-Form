# Phase 0 — De-starter, rebrand, spikes, release track

**Status: complete** (`8278b37`). Kept for the record — the spike answers it produced live in
[`docs/spikes-phase-0.md`](../spikes-phase-0.md), and the release-track items (publisher
verification, hosting the privacy policy) may still be in flight.

**Depends on:** nothing. **Unblocks:** everything.

## Goal

The repo is `turbostarter/extro` with a domain layer grafted on. It currently ships a new-tab
override, a devtools panel, a chat demo, an auth flow and Extro's icon — four purposes and
someone else's branding. That is a Chrome Web Store rejection on single-purpose grounds
before anyone looks at the code.

Remove the starter, put the product's identity in, make the removal irreversible with a CI
check, and answer three questions that the rest of the roadmap depends on.

## Required reading

- [`_context.md`](./_context.md) — the standing briefing. Read it first.
- `wxt.config.ts` — the whole file, especially the `build:manifestGenerated` hook.
- `docs/privacy.md` — the section on install-time site access.
- `src/lib/site-access.ts` — you will spike against it, not change it yet.

## Inline context

**The manifest hook is load-bearing.** WXT infers `host_permissions` from a runtime-registered
content script's `matches`, which would silently restore the all-sites grant. The hook deletes
it at the last moment before the manifest is written. An e2e test guards this. **Do not touch
it in this phase** beyond what deliverable 5 says.

**`src/components/common/logo.tsx` is already a hand-authored product mark** — it replaced the
starter's. That is your source for the icon; you do not need to invent a design.

**The starter's visible copy lives in `src/components/common/main.tsx`**, which renders
"Hello from `<filename>` 👋" plus a "Learn more" link to `github.com/turbostarter/extro`. It is
the body of the side panel, options, newtab and devtools pages. Deleting it will empty four
pages — that is expected; the side panel gets its real UI in Phase 1c.

## Deliverables

### 1. Commit what is outstanding

There are ~16 uncommitted files including ADRs 004–007, which have never been through CI.
Commit them first, as their own change, before touching anything else.

**Tests:** none. **Why:** it is a commit.

### 2. Delete the starter surface

| Delete | Note |
|---|---|
| `src/app/newtab/` | Overrides the user's new tab page. Near-certain store rejection on its own. |
| `src/app/devtools/` | Starter demo panel. |
| `src/app/tabs/` (whole directory) | Includes `ai.tsx`, which calls `streamText` + `chromeai()` directly and violates ADR 002. |
| `src/components/auth/` | ~380 lines of Supabase email/OAuth UI. |
| `src/components/common/main.tsx` | The "Hello from …" body and the Extro link. |
| `src/lib/analytics.ts` | OpenPanel. Dead — nothing imports `track`. Deleting it is also what lets the store data disclosure say "does not collect or transmit user data". |

**On analytics specifically:** the product *does* plan to collect anonymous data eventually —
unresolved fields, to grow the deterministic rules — but that arrives in Phase 8, behind an
explicit consent prompt, through ADR 007's narrowed schema. OpenPanel is the wrong mechanism
for it (a general-purpose product-analytics client with an open event shape is precisely what
`LogFields` exists to prevent). Delete it now; Phase 1b starts a local-only journal instead.

**Blast radius you will hit, in this order:**

- `src/types/index.ts` re-exports `User` from `@supabase/supabase-js`.
- `src/lib/storage.ts` has `StorageKey.USER`.
- `src/lib/messaging.ts` has exactly one message, `Message.USER`, typed against it.
- `src/app/background/index.ts` registers `onMessage(Message.USER, …)`.
- `src/components/layout/header.tsx` links to `/tabs.html#ai`.

Removing auth empties `messaging.ts`. That is fine — Phase 1c rewrites the protocol. This is
precisely why de-starter goes first: doing it after Phase 1 means writing that protocol twice.

**Dependencies:** remove `@openpanel/web`, `ai`, `chrome-ai` from `package.json`. Phase 3
re-adds exactly one model SDK, at the composition root, under ADR 002. Check whether
`react-router-dom` still has consumers after `src/app/tabs/` is gone; remove it if not. Leave
`react-hook-form` and `@hookform/resolvers` — Phase 1c's onboarding form will want them.

**Tests:** none new. **Why:** deletion is verified by the gate's grep and by the existing
suite continuing to pass. A test asserting a file is absent is what deliverable 5 is for.

### 3. Keep Supabase dormant, and prove it is unreachable

`src/lib/supabase.ts` stays (v1 decision — auth returns with monetization, and this is less to
rebuild). It returns `null` without env vars.

Add a `noRestrictedImports` rule to `biome.json` forbidding imports of `~/lib/supabase` from
`src/app/**` and `src/components/**`, with the failure message explaining that v1 is local-only
and that auth returns with its own ADR.

**Tests:** lint rule, plus one unit test asserting `supabase` is `null` under an empty env.
**Why:** the store data-handling disclosure will claim nothing is collected. A dormant auth
client in the bundle is defensible only if nothing can reach it, and "nothing reaches it" must
be mechanical rather than remembered.

### 4. Product identity

- **Icon:** render `src/components/common/logo.tsx` to a 512×512 PNG at `src/assets/icon.png`.
  `@wxt-dev/auto-icons` generates the rest. If the rendered mark does not work at 16px, say so
  in the handback and flag it for a design pass rather than shipping something illegible.
- **Locale strings:** rewrite `public/_locales/en/messages.json`. It currently holds 12
  auth-demo strings plus `extensionName` / `extensionDescription` / `privacyNote`. Remove the
  auth strings; add the strings the remaining UI needs.
- **Route all UI copy through `browser.i18n`.** Not just the strings that already are. The
  product targets forms worldwide; retrofitting i18n later costs a store-listing revision.
- **Content script badge copy:** currently "Form Agent is watching this page". Replace it.
  For a privacy product this is the worst available sentence.

**Tests:** an e2e assertion that no rendered page contains a hardcoded English string that
should have come from `browser.i18n` is overkill; skip it. **Do** re-anchor the existing e2e
branding test — see deliverable 6.

### 5. `scripts/check-release-manifest.ts`

A new check, wired into the `quality` job in `.github/workflows/tests.yml` next to
`check-bundle-secrets.ts`. It reads the built manifest and fails on any of:

- `host_permissions` present
- `chrome_url_overrides` present
- `devtools_page` present
- `content_scripts` non-empty
- CSP missing `script-src 'self'`, or containing `unsafe-eval` / `unsafe-inline` / `frame-ancestors`
- `alarms` in `permissions` (ADR 006 forbids a background sweep; the shortcut is one line)
- the sha256 of `src/assets/icon.png` equal to the vendored Extro icon's (hardcode the hash)
- the string `turbostarter`, `extro`, or `Hello from` anywhere in `build/`
- the string `localhost` anywhere in the manifest (this one matters from Phase 1c onward)

**Tests:** yes — unit tests for the checker itself, table-driven over synthetic manifests, one
case per rule. **Why:** this script is the thing that makes de-starter irreversible. A guard
nobody has watched fail is not a guard — `docs/testing.md` makes this exact argument about the
`frame-ancestors` regression. Assert each rule fires.

### 6. Re-anchor the e2e branding assertion

`e2e/extension.spec.ts` currently proves "renders our copy rather than the starter's" by
asserting a `contentinfo` contains `"stays on this device"`. That string comes from the starter
layout's footer, which this phase disturbs. Re-anchor it to something the product owns and that
will not move — a `data-testid` on the panel root, or the i18n'd product name.

**Tests:** this *is* the test. Confirm it fails if you revert the branding.

### 7. Manifest hygiene

- Add `minimum_chrome_version: "114"` (the `sidePanel` API floor).
- Confirm `chrome_url_overrides` and `devtools_page` disappear as a consequence of deleting
  those entrypoints — do not special-case them in the config.
- Add `homepage_url` and an author once the repo has a public home.

**Tests:** covered by deliverable 5.

### 8. Three spikes, timeboxed to one day each

Answers go in `docs/` (a short note, or an ADR if the answer constrains future work). Code
changes from spikes land in **Phase 1c**, not here — this phase only answers the questions.

1. **Does `chrome.permissions.request()` work from the side panel?** Load the current build,
   open the panel, call it from a button. There are Chrome versions where this silently fails
   outside a popup. The entire privacy design rests on it. If it fails, the UI shape changes
   and Phase 1c's brief must be rewritten before it is handed over.
2. **Confirm the open-tab injection gap.** `registerContentScripts` applies to subsequent
   navigations, so after a grant the user sees nothing until reload. Verify, and write down
   the fix (a follow-up `scripting.executeScript` into the active tab).
3. **Firefox MV3 target.** Set `manifestVersion: 3` for the Firefox target in `wxt.config.ts`,
   build it, and confirm the `build:manifestGenerated` hook still strips inferred
   `host_permissions` there and that `optional_host_permissions` survives. You are confirming
   feasibility only — Phase 5 does the real work.

**Tests:** none. **Why:** spikes produce knowledge, not code. If a spike produces code worth
keeping, it belongs in the phase that owns it, with that phase's tests.

### 9. Open the release track

No engineering blocker, and weeks of external latency if left late:

- Register the Chrome developer account, pay the $5 fee, start publisher verification.
- Register the AMO account.
- **Write and host a user-facing privacy policy.** GitHub Pages off this repo is fine. Do not
  paste `docs/privacy.md` — that is an engineering document. It must describe, in plain
  language: what is stored locally, that nothing is transmitted, the per-origin grant, that
  data is unencrypted at rest and protected by the operating system, and how to delete
  everything. The URL is mandatory for submission.

**Tests:** none. **Why:** these are accounts and prose.

## Gate

```bash
bun check
bun run build
bun test:e2e
grep -ril "turbostarter\|extro\|Hello from" build/     # must print nothing
bun run scripts/check-release-manifest.ts             # must exit 0
```

And, on the built Chrome manifest:

```bash
python3 -c "import json;m=json.load(open('build/chrome-mv3/manifest.json'));print(m.get('chrome_url_overrides'), m.get('devtools_page'), m.get('host_permissions'), m.get('minimum_chrome_version'))"
# expected: None None None 114
```

Then deliberately break each `check-release-manifest.ts` rule once and confirm it fails.
Report that you did this.

## Decisions to record in the handback

- Whether `permissions.request()` works from the side panel, verbatim, with the Chrome version
  tested. **Phase 1c cannot be written until this is answered.**
- Whether the logo renders legibly at 16px, or needs a design pass.
- What `react-router-dom` turned out to be used by, if anything.
- The final shape of `public/_locales/en/messages.json`.

## Out of scope

Do not build any product UI. Do not touch `src/core`. Do not wire `requestSiteAccess` to a
button — that is Phase 1c, and it depends on spike 1's answer. Do not start the extractor.

## Traps

- **Deleting `src/lib/supabase.ts`** because it looks like cruft. It is deliberately retained.
- **Adding `host_permissions` back** to make something work. If you need site access to test,
  that mechanism arrives in Phase 1c behind a `WXT_E2E` flag.
- **Leaving `analytics.ts` "in case we need telemetry".** Deleting it is what buys the clean
  store disclosure. ADR 007's observation channel is the eventual replacement, and it is
  years-later work, not a stub to preserve now.
- **Rewriting the manifest hook.** Read its comment. It exists because of a bug that shipped.
