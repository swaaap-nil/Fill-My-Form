# 011 — Required permissions are pinned to a shipped baseline

**Status:** accepted · 2026-09-24

## Context

Both stores are live and auto-update users: Chrome checks every few hours,
Firefox about daily, and installs are silent once review passes.

That silence has one exception. If an update adds a **required** permission (a
new `permissions` entry or any `host_permissions`), the browser disables the
extension for existing users until they re-approve the change. Many never notice
the prompt, so they quietly stop using the product. Optional permissions do not
trigger this: `optional_host_permissions` can gain entries, and a site can be
requested at runtime, without disabling anyone.

The repo already keeps broad site access optional (see
[ADR 009](./009-proactive-form-detection.md) and `docs/privacy.md`), and
`scripts/check-release-manifest.ts` banned `host_permissions` and `alarms`. But
it only required the known permissions to be present. Adding some other required
permission (`history`, `cookies`) passed the check and would have shipped.

## Decision

Required permissions are pinned per target in
`scripts/release-permissions-baseline.json`, and the release build fails if the
built manifest goes beyond it.

- `evaluatePermissionBaseline` in `scripts/check-release-manifest.ts` flags any
  required `permissions` entry not in the target's baseline, and any
  `host_permissions` at all. It runs inside `evaluateTargetManifest`, so it is
  part of the existing "Assert release manifests are clean" step in
  `release.yml`.
- The error says why (existing users are disabled until they re-approve) and
  what to do: prefer an optional permission; if the permission is truly
  required, add it to the baseline in the same change and call it out in the
  changelog.
- Removing a permission is allowed and is not reported. The existing
  required-permissions check still fails if a core permission goes missing.

## Alternatives considered

- **Diff against the previous GitHub release's manifest.** Catches drift
  automatically with no file to maintain, but needs network access in CI and
  has a first-release edge case. Deterministic and offline won.
- **Rely on code review and the existing bans.** This is what we had. It misses
  any permission nobody thought to ban.
- **Add permissions freely and accept the re-approval prompt.** Rejected: the
  cost is silent churn among existing users, and the store listing would show a
  scarier permission list.

## Consequences

Good:

- A permission change is a deliberate, reviewed edit to one small file rather
  than a side effect of a feature.
- The check is generic. It names no permission, so it covers future ones.

Bad:

- Someone must remember to update the baseline for a legitimate change. The
  failure message names the file, so this costs one edit.
- The baseline only knows the manifest we build. It does not know what the
  stores currently serve, so it can drift if a release is skipped or reverted.

## When to revisit

If the baseline is being edited often, the extension is probably taking on
required access it should request at runtime instead. Revisit also if releases
start to skip or roll back, in which case diffing against the live store
manifest becomes worth its cost.
