# Generalizing From Fixtures

Copied real-world pages in `test-site/` are regression fixtures, not product
targets. They exist to reveal browser, DOM, and form patterns the extension
does not handle yet.

When a copied page exposes a bug, reduce it to a general pattern before
touching production code. The fix should make the extension more resilient on
many websites, not teach it about one employer, ATS, URL, page title, field id,
class name, or fixture filename.

## Required Workflow

1. Copy or update the broken page under `test-site/`.
2. Identify the general pattern, such as:
   - a visible application form without a native `<form>` element
   - a hidden file input controlled by a labelled upload button
   - radio or checkbox options without a `<fieldset>`
   - a custom select built from ARIA widgets
   - generated field names where labels carry the meaning
3. Add or update one small synthetic test that describes that pattern without
   naming the copied page.
4. Add or update the copied-page regression fixture test.
5. Implement the reusable behavior in `src/`.

## Allowed In Production Code

- Generic DOM and accessibility signals.
- Generic field labels and ontology aliases that can appear on many sites.
- Rules named by behavior, such as `submit-adjacent-control-cluster`.
- Conservative abstention when the extension cannot resolve a field safely.

## Forbidden In Production Code

- Fixture filenames, such as `supabase.html` or `ibps-like.html`.
- Website, employer, or ATS names used to change runtime behavior.
- Copied URLs or domains from fixture metadata.
- Copied page titles.
- Copied ids, names, or class names from real pages.
- Branches like `if (origin.includes("..."))` or
  `if (document.title.includes("..."))` that target one page.

If a rare exception is genuinely required, add an inline allow comment with a
reason:

```ts
// fixture-generalization-allow: browser API requires this exact extension page
```

Use that escape hatch sparingly. The default answer should be another
generalized rule or a deliberate abstention.

