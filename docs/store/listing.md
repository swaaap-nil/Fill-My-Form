# Store listing copy — v0.1.0, unlisted trial submission

Drafted for Phase 1d's throwaway submission to Chrome Web Store and AMO,
unlisted. Purpose is to surface review friction now, at zero cost, rather than
at a real launch. Nothing here is published until a human reviews and approves
this copy for an actual listing.

## Short description (Chrome: 132 characters max)

> Fills web forms from a personal memory you control. Nothing is filled
> without your confirmation, and nothing leaves your device.

(118 characters)

## Single-purpose statement

> This extension has a single purpose: to help the user fill in web forms
> using information they have previously provided to the extension itself.
> It reads the structure of a form (field types and labels) only on sites the
> user has explicitly granted access to, proposes values from the user's own
> locally-stored answers, and writes a value into a field only after the user
> confirms that specific field. It does not browse, search, message, or
> perform any function unrelated to filling in forms.

## Full description

> **Fill forms from your own memory — nothing leaves your device.**
>
> Type your details once. This extension remembers them locally, on your
> device, and offers to fill them into forms as you encounter them — job
> applications, registration forms, government portals — one field at a
> time, with your confirmation before anything is written.
>
> **How it works**
>
> 1. Tell the extension about yourself once, in its side panel.
> 2. On a form, grant the extension access to that site — one origin at a
>    time, revocable at any moment from the same panel.
> 3. The extension reads the form's structure (what each field is asking
>    for) and proposes a value for the fields it recognises.
> 4. You review each proposal — the value, and where it came from — and
>    confirm it before it is written into the page. Nothing is filled
>    automatically.
>
> **What makes this different**
>
> - **No account, no server.** Your information is stored on your device
>   only. This extension does not collect or transmit user data.
> - **No blanket access.** The extension has no access to any website until
>   you grant it, one site at a time. `chrome://extensions` will show no
>   site access after installing it.
> - **Sensitive fields always ask.** Government ID numbers, financial and
>   health information always require your explicit confirmation, every
>   time — even if you confirmed the same field before.
> - **Nothing is ever submitted for you.** This extension fills fields. It
>   never clicks a form's submit button. You always do that yourself.
>
> This is an early version. It currently recognises common personal,
> contact, education and employment fields; coverage is still growing.

## Data-handling disclosure

> **This extension does not collect or transmit user data.**
>
> All information the user provides is stored locally in the browser and is
> never sent to any server. The extension makes no network requests of its
> own. There is no account, no sign-in, and no analytics.

Verified true against the current codebase before submitting, not merely
asserted: `src/lib/supabase.ts` is dormant and unreachable from `src/core` or
`src/components` (`biome.json`'s `noRestrictedImports`, enforced in CI), there
is no analytics client wired up, and `scripts/check-bundle-secrets.ts` /
`scripts/check-release-manifest.ts` both run in CI against every build. See
`docs/privacy.md`.

## Per-permission justification

Chrome and Firefox both ask for a plain-language reason per requested
permission. One paragraph each, reusable for both stores.

**`storage`**
> Used to save the information the user types into the extension's own side
> panel (their name, contact details, education history, etc.) so it
> persists between browser sessions. This data stays on the device; the
> permission does not grant any network access.

**`sidePanel`**
> Provides the extension's only user interface: a side panel where the user
> reviews and enters their information, grants or revokes access to sites,
> and confirms which values get filled into a form. Required for the
> extension to have a UI at all in Manifest V3.

**`activeTab`**
> Lets the extension identify the currently active tab only after the user
> interacts with the extension, so it can connect a scan request to the tab
> the user is looking at rather than needing broad, always-on page access.

**`tabs`**
> Lets the side panel read the active tab's URL and title so it can request
> access to exactly that site's origin and show/revoke the corresponding
> grant. It does not let the extension read or change page contents; the
> content script still only runs after the user approves the separate
> per-origin host permission prompt.

**`scripting`**
> Used to inject the extension's form-reading and form-filling code into a
> page — but only for an origin the user has explicitly granted access to
> via the runtime permission flow below. No script is injected into any
> page before that grant.

**`optional_host_permissions` (`http://*/*`, `https://*/*`)**
> Forms exist on arbitrary domains. The extension ships with **no** host
> permissions at install. On first opening the side panel, the user may
> grant all http(s) sites in one runtime prompt (local form detection and
> notifications with counts only — no auto-fill). If they decline, access
> is requested *per origin* when they scan a page. Access can be revoked in
> the panel or browser settings.

**`notifications`**
> Used only to tell the user that fillable fields matching their saved
> answers were detected on a page they are viewing. Notification text
> contains counts only, not personal data. Clicking focuses the tab and
> opens the fill panel.

## Screenshots (1280×800)

Brief explicitly asks for these two, since they're what differentiate this
product from a generic "AI form filler" — a reviewer who sees the consent
mechanics in the screenshots reads the permission justifications above more
generously.

1. **The per-origin grant prompt.** The side panel's "Grant access to this
   site" button, ideally with the browser's native permission bubble visible
   alongside it (or, if that cannot be captured reliably via automation, the
   panel state immediately before/after the click, with the granted-origins
   list visible).
2. **The confirmation review.** The side panel showing a scanned page's
   proposals — at least one `pending` (value + source + policy reason) and
   the `restricted` state's distinct styling — before anything is confirmed.

A third, optional screenshot: the onboarding form, to show where values come
from.

See `scripts/capture-store-screenshots.ts` for a Playwright script that
drives the built extension against the local fixture site and saves these
three at the required resolution — review the output before use; a reviewer
sees these images, and automation is a starting point, not a substitute for
a human confirming they read cleanly at store-listing size.
