# Phase 1d submission log

Running record of the trial submission. Updated as things come back — a
pending review is not a failure of this phase; an unrecorded one is.

## Status

| Store | Status | Date | Notes |
|---|---|---|---|
| Mozilla AMO (Firefox) | **Submitted, pending review** | 2026-09-05 | Unlisted, `0.1.0`, id `ff@swapnilsuman.me`. Manual first upload via AMO's web UI (see below for why). Source code uploaded and disclosure question answered. Fully lodged — awaiting reviewer outcome. |
| Chrome Web Store | **Not yet submitted** | — | Blocked on creating the developer account ($5 one-time fee) — the user's own account/payment, not something this session can do. |

## What was exercised (deliverable 1)

- `wxt submit --dry-run` against both targets together fails immediately:
  passing `--chrome-zip` at all forces Chrome credential validation even
  when only Firefox is being submitted. The two targets cannot be
  dry-run or submitted independently through one invocation — you must
  omit the other target's flags entirely, which `publish.yml` does not do
  (it always passes both). **Phase 6 gap.**
- `wxt submit --dry-run` **cannot validate a first-time Firefox
  submission at all.** `FirefoxAddonStore.submit()` (in
  `publish-browser-extension`, the library `wxt submit` wraps) does an
  unconditional `GET /addons/addon/{id}` to fetch existing add-on details
  as its very first step, before checking `dryRun` and before any upload.
  For an id that has never been used, AMO returns `404 Not Found` and the
  whole call throws — dry-run or not. There is no code path for "this
  add-on doesn't exist yet, create it."
  - **Consequence:** the JWT API (and therefore `wxt submit`, and
    therefore `publish.yml`) only ever supports uploading a **new version**
    to an **already-existing** add-on. The first version of any Firefox
    add-on must be submitted through AMO's web UI, by hand, logged in as
    the account owner. This is not a bug in our pipeline to fix — it's
    Mozilla's actual API shape. **Phase 6 must know this**: the "first
    release" run of `publish.yml` will hit the exact same 404 on Firefox
    and cannot be made to work without a preceding manual step.
- Running the *real* (non-dry-run) submit against a nonexistent id hits
  the identical 404 — confirmed there is no hidden "create if missing"
  behavior gated behind `--dry-run` specifically.
- **A real, separate finding, unrelated to the above:** building for
  Firefox emitted `WARN Firefox requires data_collection_permissions for
  new extensions from November 3, 2025`. This is not a warning to
  suppress — AMO has made this mandatory for new extensions. Fixed by
  declaring `browser_specific_settings.gecko.data_collection_permissions:
  { required: ["none"] }` in `wxt.config.ts`, scoped to the Firefox build
  only (Chrome ignores the whole `browser_specific_settings` key, so it is
  omitted from the Chrome manifest entirely rather than shipped inert).
  "None" is also the honest, verified answer — see docs/privacy.md.
- Also found and fixed in passing: no `browser_specific_settings.gecko.id`
  existed before this phase, which is why the pre-existing
  "Firefox requires extension ID" build warning had never gone away. Set
  to `ff@swapnilsuman.me` — Mozilla's own documented convention (an
  email-shaped string that need not be a real, receiving address), chosen
  by the user, and public once submitted (visible in the manifest and the
  AMO listing).
- `BUILD.md`'s instructions were verified to work as written:
  `bun install --frozen-lockfile` followed by `bun run build:firefox`
  reproduces the submitted zip's contents from the committed `bun.lock`.

## Listing copy and assets (deliverable 2)

Drafted in `docs/store/listing.md`: short description, single-purpose
statement, full description, data-handling disclosure, and one paragraph of
justification per permission (`storage`, `sidePanel`, `activeTab`, `tabs`,
`scripting`, the optional broad host permission pattern).

Three screenshots captured at 1280×800 via
`scripts/capture-store-screenshots.ts` (Playwright, driving the built
`build-e2e` extension against the local fixture site): the onboarding form,
the post-grant panel state, and the confirmation review showing a `pending`
proposal, several abstentions, an `ambiguous` case, and the `restricted`
Aadhaar field's distinct styling. Saved to `docs/store/screenshots/`.

**Honest caveat recorded, not glossed over:** Playwright cannot drive
Chrome's native permission bubble, so the "grant" screenshot shows the
panel's state immediately after granting (the origin now listed under
"Sites you've granted access to"), not the OS-level dialog itself. Noted in
`listing.md`.

**Also honest:** the UI is exactly as unpolished as `docs/roadmap/_context.md`
says it should be at this stage — plain bordered boxes, no visual hierarchy,
no icon-only buttons styled. That is correct for an unlisted trial whose
purpose is discovering review friction, not correct for a real launch.
Real launch screenshots should wait for actual UI design.

## Submission details (deliverable 3)

- **Firefox / AMO:** submitted 2026-09-05, unlisted, version `0.1.0`,
  add-on id `ff@swapnilsuman.me`. Uploaded via AMO's web UI (see the
  dry-run finding above for why the CLI path could not be used for this
  first submission).
  - AMO's submission flow asks a yes/no disclosure question: "Do you use
    any of the following in your extension? Code generators or minifiers /
    tools that combine multiple files into a single file / web template
    engines / any other tool that takes code or files, applies processing,
    and generates code or file(s)". Answered **Yes** — WXT's build uses
    Vite/Rollup (bundling), esbuild/Terser (minification), TypeScript
    (compilation), and Tailwind CSS (utility-class compilation).
    Answering yes triggers AMO's mandatory source-code upload flow.
  - AMO's source-code page states the submitted source **must not** be
    transpiled, concatenated, or minified. Verified before upload:
    `build/fill-my-form-0.1.0-sources.zip` is the raw repository (245
    files, plain readable `.ts`/`.tsx` with comments intact — spot-checked
    `src/lib/site-access.ts` — not the built/bundled output), with
    `BUILD.md` present at the root as required.
  - `build/fill-my-form-0.1.0-sources.zip` uploaded to AMO as the source
    code.
- **Chrome Web Store:** not yet submitted. Requires the user to create a
  Chrome Web Store Developer Dashboard account (one-time $5 registration
  fee) and generate OAuth credentials (`CHROME_CLIENT_ID`,
  `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN`) via a Google Cloud
  project — none of which this session can do on the user's behalf.

## What came back (deliverable 4) — to be filled in as it arrives

- **Publisher verification time:** pending — AMO does not require separate
  publisher verification the way Chrome Web Store does for some developer
  accounts, but note here if anything of that shape appears.
- **Reviewer questions, verbatim:** none yet.
- **Rejection reason(s), if any, and the fix:** none yet.
- **Did the AMO source build succeed from `BUILD.md` alone?** unconfirmed
  until a reviewer (or the automated linter) reports back; `BUILD.md`
  itself was verified locally to reproduce the build (see above).
- **What the pipeline could not do, for Phase 6:**
  1. `publish.yml` cannot submit Firefox and Chrome independently — it
     always passes both zips, so a missing credential for either target
     fails the whole job.
  2. `publish.yml`'s first-ever run will fail on Firefox regardless of
     credentials, because no add-on exists yet at the configured id. The
     manual first-upload step (done in this phase) is a permanent
     prerequisite, not a one-time inconvenience Phase 6 can script away.
  3. No version-bump step exists; `0.1.0` is now spent for Firefox.
  4. No dry-run gate before the real submit step in CI.
  5. `build/*-chrome.zip`-style shell globs break if more than one
     matching zip is ever present in `build/` (not hit this session, since
     `build/` was rebuilt fresh each time, but worth a guard).

## Gate check

Firefox is lodged and pending review — satisfies "either approved or
rejected with a reason you now understand" is not yet met for Firefox
(still pending; update this file when it resolves) and Chrome has not been
lodged at all yet (blocked on the user's account creation). Per the phase
brief, a pending review is not a failure of this phase; recording nothing
would have been.
