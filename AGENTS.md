# Agent Instructions

## Hard Design Rule: Generalize From Fixtures

Never build page-specific solutions into production code. The goal is a
resilient extension that handles broad classes of browser, DOM, and form
behavior across the web, not an extension that knows how to pass one copied
HTML page.

Copied real-world pages in `test-site/` are regression fixtures: use them to
discover general browser/form patterns, then implement the general pattern in
`src/`. Do not special-case a fixture, website, URL, application name, employer
name, page title, copied field id/name/class, or copied fixture filename.

Before touching extraction, matching, fill, or verification behavior for a
copied page, read `docs/generalizing-from-fixtures.md` and follow its workflow:
copied fixture, synthetic generalized test, copied-page regression, reusable
implementation.

Good fixes look like:

- Recognize generic DOM patterns, such as file picker labels that say
  "Choose file" while the real prompt sits nearby.
- Improve reusable extraction behavior, such as radio groups without
  `<fieldset>` using a shared question label.
- Add reusable ontology concepts or aliases that could appear on many sites.

Bad fixes look like:

- `if (origin.includes("ibps"))`.
- `if (field.name === "picture")`.
- `if (document.title.includes("Supabase"))`.
- Adding AAI/IBPS-specific concepts for one application workflow.
- Making copied fixture filenames part of runtime behavior.

When a copied page exposes a bug, add or update at least one small synthetic
test that states the generalized behavior independently of that page. The copied
page may stay as an integration fixture, but the product behavior must be
explained without referencing that page.
