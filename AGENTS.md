# Agent Instructions

## Hard Design Rule: Generalize From Fixtures

Never build page-specific solutions into production code.

Copied real-world pages in `test-site/` are regression fixtures: use them to
discover general browser/form patterns, then implement the general pattern in
`src/`. Do not special-case a fixture, website, URL, application name, employer
name, or copied field id/name/class.

Good fixes look like:

- Recognize generic DOM patterns, such as file picker labels that say
  "Choose file" while the real prompt sits nearby.
- Improve reusable extraction behavior, such as radio groups without
  `<fieldset>` using a shared question label.
- Add reusable ontology concepts or aliases that could appear on many sites.

Bad fixes look like:

- `if (origin.includes("ibps"))`.
- `if (field.name === "picture")`.
- Adding AAI/IBPS-specific concepts for one application workflow.
- Making copied fixture filenames part of runtime behavior.

When a copied page exposes a bug, add or update at least one small synthetic
test that states the generalized behavior independently of that page. The copied
page may stay as an integration fixture, but the product behavior must be
explained without referencing that page.
