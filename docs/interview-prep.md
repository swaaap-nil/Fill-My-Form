# Interview Prep: Fill My Form

Use this as a revision sheet before interviews. The goal is not to memorize
every file, but to be able to explain the product, the architecture, the
tradeoffs, and the failure modes clearly.

## 30-second pitch

Fill My Form is a privacy-first browser extension that understands web forms
and helps fill them from a local personal memory. The core idea is that form
understanding, matching, policy, and verification are domain logic, while the
browser, DOM, storage, UI, analytics, and cloud integrations are adapters.

The product is designed around a hard privacy boundary: personal memory, form
values, files, page content, and agent context stay on the device. That is
enforced through architecture, lint rules, manifest tests, schema validation,
and explicit policy decisions, not just documentation.

## One-minute architecture answer

The repo is a single TypeScript package using WXT for the extension, React for
the UI, Bun for tests/scripts, Biome for linting, and Playwright for browser
e2e tests.

The dependency direction is:

```text
src/app        extension entrypoints
src/components React UI
src/lib        adapters: DOM, storage, messaging, analytics, site access
src/core       pure domain logic
```

`src/core` imports no React, browser APIs, Supabase, OpenPanel, or model SDKs.
Biome enforces those import boundaries, so core tests run in plain Bun with no
DOM, no extension host, and no network.

Important modules:

- `src/core/form`: DOM-free `FormIR` types.
- `src/lib/form/extract.ts`: DOM adapter that turns real pages into `FormIR`.
- `src/core/ontology`: canonical concepts and aliases.
- `src/core/matching`: deterministic field-to-concept matching.
- `src/core/memory`: local memory contracts and write behavior.
- `src/core/fill`: straight-line fill planning.
- `src/core/policy`: what actions are allowed, denied, or require confirmation.
- `src/core/agent`: phases, statuses, actions, and transition rules.
- `src/core/tools`: validated tool registry and execution path.
- `src/core/verification`: compare intended fill with observed page state.

## Demo flow to explain

1. The side panel asks for site access only when needed.
2. The content script extracts page structure into a `FormIR`, without storing
   entered values in the observation.
3. Matching tries deterministic tiers first: autocomplete, type narrowing,
   exact aliases, placeholder coverage, and nearby text coverage.
4. The fill planner looks up local memory for resolved concepts.
5. Policy decides whether a proposed write can happen, needs confirmation, or
   must be denied.
6. The UI shows proposals and pending decisions.
7. Only after user confirmation does a pending decision become a content-script
   fill instruction.
8. Verification reads the page back and compares reality to intent.

## What to emphasize

### Privacy is structural

Good answer:

> I did not treat privacy as a preference flag. The core layer cannot import
> network clients. Personal memory uses a `MemoryStore` contract whose planned
> production implementation is IndexedDB. The extension requests no host access
> at install time. The build strips inferred host permissions, and e2e tests
> assert the manifest shape. Logs and analytics use closed allowlists so values
> and page content cannot accidentally leak through flexible metadata.

Specific details to remember:

- Manifest uses `activeTab`, `tabs`, and no required `host_permissions`.
- Runtime site access lives in `src/lib/site-access.ts`.
- WXT may infer host permissions, so `wxt.config.ts` has a manifest hook.
- `scripts/release-permissions-baseline.json` pins required permissions.
- `src/core/logging.ts` has a closed `LogFields` interface.
- Analytics are optional and anonymous through `src/lib/analytics`.
- Files are prepared locally; no OCR or document understanding exists.

### The model is untrusted input

Good answer:

> The model proposes actions, but runtime code validates and controls them. A
> model action is parsed against a tool schema, checked by policy, executed by
> our adapter code, validated again against the tool output schema, and then
> verified against the page. The action vocabulary intentionally excludes
> dangerous operations like arbitrary script execution, navigation, or final
> submission.

Specific details:

- `AgentAction` is only `call_tool`, `ask_user`, `request_review`, or `finish`.
- `executeTool` validates input and output with Zod.
- The agent receives only tools for the current capability domain.
- Final submission is always denied by default policy.

### Deterministic first

Good answer:

> The extension should not ask an LLM to solve problems that HTML and product
> data can solve. Matching starts with deterministic, cheap, testable tiers and
> only escalates when necessary. This makes the system faster, cheaper, more
> private, and easier to evaluate.

Matching tiers in order:

1. `autocomplete` token.
2. Field kind/type narrowing when exactly one concept expects that kind.
3. Exact normalized alias.
4. Placeholder alias-token coverage.
5. Nearby text alias-token coverage.

Key nuance:

- Ambiguity stops the cascade. A weaker later tier is not allowed to
  "un-confuse" a genuine tie.
- `Certainty` has `known`, `unknown`, `ambiguous`, and
  `requires_confirmation`; there is no "guess".

### Extraction is an adapter

Good answer:

> DOM extraction lives outside core because it depends on browser APIs. It
> walks the composed tree, handles native controls and ARIA comboboxes, groups
> radios and multi-checkboxes, skips hidden/disabled/read-only controls, and
> resolves labels using accessibility signals first. It returns a domain shape
> that core can reason about without ever seeing the DOM.

Important extraction details:

- `src/lib/form/extract.ts` is the main file.
- It walks open shadow roots and declarative shadow roots.
- It groups radio buttons and repeated checkboxes by `name`.
- It skips hidden, password, disabled, read-only, submit/reset/button/image
  controls, and invisible elements.
- Label order includes `<label for>`, wrapping labels, ARIA labels,
  `aria-labelledby`, legends, nearby sibling text, and placeholder.
- It caps fields with `MAX_FIELDS_PER_PAGE` to bound pathological pages.
- It treats copied real-world pages as regression fixtures, never production
  targets.

### Fill planning is not page writing

Good answer:

> `planFill` does not write to the page. It produces proposals and pending
> decisions. That separation matters because the UI must show the user what
> will happen, and policy must be re-evaluated when a pending decision is
> confirmed.

Core flow in `src/core/fill/driver.ts`:

```text
resolve(field) -> memory.get(profileId, concept) -> freshness -> policy -> proposal
```

Important details:

- File fields require a file reference, not arbitrary text.
- Closed-vocabulary fields resolve stored text to one of the page's actual
  options.
- Ambiguous option resolution creates choices for the user.
- Restricted sensitivity is shown as restricted and requires confirmation.
- `confirmDecision` trusts only the stored `PendingDecision`, not caller-sent
  values.

### Policy is centralized

Good answer:

> Policy is deliberately blunt and centralized. It denies final submission and
> destructive actions, requires confirmation for restricted data, requires
> confirmation for low confidence, and only allows narrow low-risk public
> actions automatically. The rest defaults to confirmation.

Default policy rules:

- `isSubmission` is denied.
- `ActionRisk.DESTRUCTIVE` is denied.
- `Sensitivity.RESTRICTED` requires explicit confirmation.
- User-confirmed actions may proceed unless denied above.
- Low confidence requires confirmation.
- Public, low-risk actions may auto-run.
- Everything else requires confirmation.

### Agent loop is resumable

Good answer:

> The agent runtime is an explicit state machine. Its state is
> JSON-serializable so a run can survive a service worker restart. The side
> panel observes runs; it does not own them.

Phases:

```text
OBSERVE -> UNDERSTAND -> RETRIEVE -> PLAN -> ACT -> VERIFY -> DONE
```

Important transition:

- Failed verification returns to `PLAN`, not directly to `ACT`.
- This forces a retry to be re-decided, not blindly repeated.

## Likely interview questions

### Product and architecture

1. What problem does this extension solve?
2. Why is this a browser extension instead of a web app?
3. Why WXT?
4. Why a single package instead of a monorepo?
5. What belongs in `src/core` versus `src/lib`?
6. How are architecture boundaries enforced?
7. What are the highest-risk parts of the system?
8. What is implemented now versus planned?
9. What would you build next?
10. How would you onboard another engineer to this repo?

### Privacy and security

1. How do you prevent personal data from leaving the device?
2. Why is IndexedDB acceptable even though it stores plaintext?
3. How do you avoid asking for all-sites permission at install time?
4. What could accidentally leak through logs?
5. What could accidentally leak through analytics?
6. Why can environment variables in an extension not contain secrets?
7. How do you prevent model output from becoming executable code?
8. Why is final form submission never automatic?
9. What is the difference between page content and shared site knowledge?
10. How would you design a cloud sync feature without violating the current
    privacy model?

### Form extraction

1. How do you discover form controls on arbitrary pages?
2. Why does extraction live outside core?
3. How are labels resolved?
4. How do you handle fields without `<label>`?
5. How do you handle radio groups?
6. How do you handle custom comboboxes?
7. Why skip hidden/password/disabled/read-only fields?
8. How do shadow DOM controls work?
9. How do you avoid over-extracting text from the whole page?
10. What is the field cap for?

### Matching

1. Explain the deterministic matching cascade.
2. Why does autocomplete come first?
3. Why does type narrowing only work for unique concept expectations?
4. What is normalized alias matching?
5. What is alias-token coverage?
6. Why do short aliases not work for placeholder/nearby coverage?
7. Why does ambiguity stop the cascade?
8. How do locale-specific aliases work?
9. How would you add semantic retrieval?
10. How do you evaluate matching quality?

### Fill and policy

1. What does `planFill` return?
2. Why separate proposals from actual DOM writes?
3. What is a pending decision?
4. How are select options resolved?
5. How are file fields handled?
6. What happens when memory has no value?
7. What happens when memory is stale?
8. What is restricted data?
9. Why does confirmation re-run policy?
10. How would you support multi-step forms?

### Agent and tools

1. Why use a state machine for the agent?
2. What are the phases?
3. Why are phase and status separate?
4. How do service worker restarts affect design?
5. What actions can the model propose?
6. What actions are intentionally missing?
7. How does progressive disclosure of tools work?
8. Why validate tool outputs?
9. How do policy and tools interact?
10. How would you add a new tool?

### Testing and release

1. Why are core tests fast?
2. What should be unit-tested versus e2e-tested?
3. Why does file preparation split arithmetic into core and pixels into e2e?
4. Why are copied real-world pages fixtures, not targets?
5. What is the generalized-fixtures rule?
6. Why is there no real Firefox Playwright e2e?
7. What does `bun check` cover?
8. What does `bun test:e2e` cover?
9. What does the manifest e2e test protect?
10. How would you debug a flaky e2e test?

### Frontend and extension UI

1. Why side panel instead of popup only?
2. Why is the image editor a separate popup window?
3. How does the side panel communicate with background/content scripts?
4. Why does the panel observe agent runs instead of owning them?
5. How does first-run access work?
6. How do nudges work without collecting new data?
7. How would you design the review UI for sensitive data?
8. How would you keep UI state consistent after service worker restarts?
9. How are local data controls exposed?
10. How would you make this accessible?

## Deep-dive answers to practice

### Why no page-specific fixes?

Copied pages in `test-site/` are regression fixtures. The production extension
must learn general DOM and accessibility patterns, not site names, filenames,
page titles, employer names, or copied field IDs. When a copied page exposes a
bug, the workflow is:

1. Identify the general pattern.
2. Add a small synthetic test for that pattern.
3. Add or keep the copied-page regression.
4. Implement reusable behavior in `src/`.

This prevents the product from becoming a pile of brittle fixture hacks.

### What is the most important design tradeoff?

The main tradeoff is accepting some friction in exchange for safety and trust.
The extension does not auto-submit, does not guess unknown values, does not read
document contents, and does not ask for broad permissions at install time. That
means some flows require user confirmation, but the user can understand and
trust what happened.

### Why not send the page to an LLM?

Because page content can include personal information, tokens, private portals,
and form values. The architecture starts from the cheapest useful observation
and fetches more field context only when needed. This reduces token cost and
latency, but the bigger reason is privacy: fields the agent never asks about
never enter a prompt.

### How would you handle a field the matcher cannot resolve?

It becomes `unknown` or `ambiguous`, not guessed. The UI can ask the user, and
the unresolved-field journal can record the local observation. A future opt-in
contribution flow may send non-personal site observations, but not personal
values or account-linked browsing history.

### How would you add a new form concept?

Add it to `src/core/ontology/concepts.json` with canonical key, aliases,
expected value kind, sensitivity, and any autocomplete tokens. Because concepts
are data, most additions should not require code changes. Then add tests for
matching behavior, especially ambiguity and sensitivity.

### How would you add a new matching tier?

Add it in `src/core/matching`, place it deliberately in the cascade, and keep
the same return shape: zero candidates, one known candidate, or multiple
ambiguous candidates. Add unit tests and, if it came from a copied fixture, add
a synthetic generalized test first.

### How would you add cloud sync?

Do not swap the local `MemoryStore` for a remote one behind the same interface.
That would violate the current privacy model. Cloud sync would need a separate
ADR, explicit consent, clear encryption and account-linking decisions, a
separate threat model, export/delete behavior, and tests proving that local-only
flows still work without configuration.

### How would you debug "the extension filled the wrong value"?

Start with the layer where the wrong decision could have appeared:

1. Extraction: did the field get the right label, kind, options, and nearby
   text?
2. Matching: did `resolve()` choose the right concept and tier?
3. Memory: did `memory.get()` return the intended profile value?
4. Option resolution: did stored text map to the page's actual option?
5. Policy: was confirmation required and shown correctly?
6. Fill adapter: did the content script write the intended payload?
7. Verification: did readback catch mismatch?

### How would you debug "the field was not detected"?

Check whether it was intentionally skipped: hidden, password, disabled,
read-only, invisible, or an unsupported widget. Then check whether it lives in
shadow DOM, lacks a native form control, uses ARIA roles, or has meaning only
in surrounding text. If the bug comes from a copied page, reduce it to a
general DOM pattern before touching production code.

### How would you explain stale memory?

Memory values have freshness rules. A stale value is not necessarily wrong, but
confidence drops. In `planFill`, stale memory lowers confidence, which can push
the policy decision toward requiring confirmation.

## Files to know cold

- `README.md`: product pitch, commands, architecture summary.
- `docs/architecture.md`: boundary and domain-module explanation.
- `docs/privacy.md`: enforceable privacy model.
- `docs/agent.md`: state machine and tool trust pipeline.
- `docs/testing.md`: test strategy and fixture philosophy.
- `docs/generalizing-from-fixtures.md`: anti-special-casing workflow.
- `src/lib/form/extract.ts`: DOM-to-FormIR adapter.
- `src/core/matching/resolve.ts`: deterministic matcher.
- `src/core/fill/driver.ts`: proposal and pending-decision planner.
- `src/core/policy/default.ts`: default allow/confirm/deny rules.
- `src/core/tools/registry.ts`: tool registration and validation path.
- `src/core/agent/types.ts`: state machine vocabulary.
- `src/core/memory/store.ts`: memory boundary.
- `wxt.config.ts`: manifest and extension configuration.
- `biome.json`: enforced import boundaries and safety linting.
- `package.json`: scripts and tech stack.

## Commands to know

```bash
bun install
bun dev
bun dev:site
bun lint
bun typecheck
bun test
bun check
bun run build:e2e
bun test:e2e
bun run eval
bun run build
```

Interview answer for local quality gate:

> My default local gate is `bun check`, which runs lint, typecheck, coverage,
> forbidden-dependency checks, and generalized-fixture checks. For browser
> behavior I run `bun test:e2e`, which builds the extension and drives Chromium
> against local fixtures.

## Common criticisms and good responses

### "Why not use an LLM for all matching?"

LLMs are useful later in the cascade, but using them first would be slower,
more expensive, harder to test, and worse for privacy. Autocomplete, labels,
input types, and aliases already solve many fields deterministically.

### "Why not auto-submit when confidence is high?"

Submission is an irreversible boundary. Filling a visible field can be
reviewed and corrected; final submission sends data to a third party. The
policy denies automatic submission regardless of confidence.

### "Why not encrypt IndexedDB yourself?"

The repo currently relies on OS/browser profile security. Adding passphrase
encryption creates recovery, sync, key-management, and UX problems. It may be
worth doing later, but it should be a deliberate feature with its own threat
model, not a checkbox.

### "Why no real third-party-site e2e?"

Real sites change, rate-limit, and break for reasons unrelated to this product.
The repo uses local fixtures to make failures meaningful and repeatable. Copied
real-world pages can be regression fixtures, but production code must generalize
from them.

### "Why no remote memory backend?"

Because the product promise is local-first personal data. A remote backend is
not just another adapter; it changes the privacy contract. It would require
explicit consent and its own architecture decision.

## Questions to ask the interviewer

- Do you optimize more for rapid automation or user trust when handling
  sensitive personal workflows?
- How do you evaluate AI-assisted features that must abstain safely?
- What boundaries do you enforce with tooling versus code review convention?
- How do you treat browser-extension permissions in your release process?
- What kinds of e2e tests have been most valuable for your team?
- How do you decide when an LLM is the right layer versus deterministic logic?

## Study plan

### Pass 1: product story

Read:

- `README.md`
- `docs/privacy.md`
- `docs/architecture.md`

Practice:

- 30-second pitch.
- One-minute architecture explanation.
- Privacy model explanation.

### Pass 2: core flow

Read:

- `src/lib/form/extract.ts`
- `src/core/matching/resolve.ts`
- `src/core/fill/driver.ts`
- `src/core/policy/default.ts`

Practice:

- Walk one field from DOM extraction to pending decision.
- Explain unknown, ambiguous, no-value, restricted, and pending proposals.

### Pass 3: agent and safety

Read:

- `docs/agent.md`
- `src/core/agent/types.ts`
- `src/core/tools/registry.ts`

Practice:

- Explain tool validation.
- Explain why failed verification goes back to planning.
- Explain what the model cannot do.

### Pass 4: tests and release

Read:

- `docs/testing.md`
- `docs/generalizing-from-fixtures.md`
- `package.json`
- `scripts/check-generalized-fixtures.ts`
- `scripts/check-release-manifest.ts`

Practice:

- Explain unit versus e2e coverage.
- Explain the copied-fixture workflow.
- Explain how manifest permissions are guarded.

## Fast self-quiz

Answer these without looking:

1. What are the five matching tiers?
2. Why is `src/core` DOM-free?
3. What data never leaves the device?
4. What does `planFill` produce?
5. What actions can `AgentAction` express?
6. Why does a failed verification go back to `PLAN`?
7. Why is final submission denied?
8. What is the generalized-fixtures rule?
9. What does `executeTool` validate?
10. What command is the local quality gate?

