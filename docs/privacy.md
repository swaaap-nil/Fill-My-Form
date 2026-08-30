# Privacy

The product claim is that your personal information stays on your device. This
document is how that claim is kept honest — every rule below has a mechanism, not
just an intention.

## The boundary

| Local-only, always | Cloud-eligible |
|---|---|
| Personal memory | Authentication |
| Personal files, photos, signatures | Subscription and billing |
| Documents | Anonymous usage metadata |
| Form values | Non-sensitive diagnostics |
| Page content | Shared, non-personal website mappings |
| Agent context containing personal data | Anonymous evaluation data |

Anything on the left leaving the device requires an explicit, separately
consented feature with its own ADR. It is never a configuration change and never
an adapter swapped in behind an interface.

## How each rule is enforced

### Personal memory cannot reach the network

`biome.json` forbids `src/core/memory/**` from importing Supabase, OpenPanel, a
model SDK or `#imports`. Violations fail `bun lint` and therefore CI.

```bash
echo 'import { createClient } from "@supabase/supabase-js";' >> src/core/memory/store.ts
bun lint   # fails: "Personal memory is LOCAL-ONLY and must never be given a network client."
```

The whole of `src/core` carries the same restriction; `memory/` carries a
stricter version.

### No site access at install time

The manifest ships with `activeTab` and **no** `host_permissions`. Access to a
site is granted by the user, one origin at a time, through
`requestSiteAccess()` in `src/lib/site-access.ts`, and the content script is
registered for that origin only.

The content script uses `registration: "runtime"` so it is not declared in the
manifest — a declared content script matching `<all_urls>` would grant injection
into every page at install time and show "read and change all your data on all
websites" regardless of the permission list.

WXT infers `host_permissions` from a runtime-registered script's `matches`, so a
`build:manifestGenerated` hook in `wxt.config.ts` strips it. **If that hook is
removed, `chrome://extensions` silently starts saying "on all sites".** Verify
after any manifest change:

```bash
bun run build:chrome
python3 -c "import json;print(json.load(open('build/chrome-mv3/manifest.json')).get('host_permissions'))"
# expected: None
```

### Model output is never executed or rendered as HTML

The CSP for extension pages is `script-src 'self'; object-src 'self'` — no
`unsafe-eval`, no remote script. `noDangerouslySetInnerHtml` is an error in
`biome.json`. The starter rendered model output through `marked` into
`dangerouslySetInnerHTML`; that was removed, and model output is rendered as
text.

The agent has no tool that executes JavaScript, and `AgentAction` has no member
that could express it.

### Logs cannot carry personal values

`LogFields` in `src/core/logging.ts` is a closed interface with no index
signature. Passing an unlisted key is a type error:

```ts
logger.info("filled", { fieldId: "f1", conceptKey: "contact.email" });  // ok
logger.info("filled", { value: "swapnil@example.com" });                 // type error
```

Adding a key to `LogFields` is a deliberate act that should be reviewed against
this document. `AppError.toLogFields()` omits `message`, because messages tend to
quote their input.

### No secrets in the bundle

Everything in `.env` is compiled into the extension and readable by anyone who
installs it. `env.config.ts` declares only `VITE_`-prefixed public values.
`scripts/check-bundle-secrets.ts` scans the build output for secret-shaped
strings and fails CI.

Server secrets — `OPENAI_API_KEY`, `STRIPE_SECRET_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` — belong to a backend the extension talks to. If a
feature needs one, the extension calls an endpoint; it does not hold the key.

### Cloud integrations are off by default

Supabase and OpenPanel are optional. With no keys configured, `supabase` is
`null` and `track()` is a no-op — no auth requests, no analytics requests. The
extension is fully functional and fully anonymous out of the box, and CI builds
with an empty environment to keep it that way.

## When analytics is enabled

Only anonymous product events. Never memory values, form values, file names,
page content, or URLs with query strings. `LogFields` is the guide for what is
safe: identifiers, enumerations and measurements.

`origin` is loggable; a full URL is not. A query string can carry a session
token, an email address or a search term.

## Verification results

`VerificationIssue.expected` and `.actual` may contain personal data — they hold
what was typed and what the page shows. They exist for the review UI and the
agent's next decision. Log `code` and `fieldId` only; `LogFields` will not let
you log the others by accident.

## Threat model, briefly

**A malicious page** can put anything in a label, including text aimed at the
model. Mitigation: the model cannot execute code, cannot write memory, cannot
submit a form, and only sees tools for its current phase. The worst outcome is a
bad proposal the user is shown and can reject.

**A compromised dependency** is the reason for the CSP, the secret scanner, and
keeping `src/core` free of network clients.

**Us, by accident** is the most likely threat, and the reason every rule above is
a build failure rather than a paragraph.

## Final submission

Never automatic. `defaultPolicy` denies it unconditionally — not gated on
confidence, not gated on confirmation, not configurable. The user presses submit.
