# BeetleJuice v1.1.0: product refinement

A second pass on v1.0.0, planned from an audit of the running product. The reconciliation engine, the maker-checker rules and the schema constraints
are unchanged (engine version 1.0.0); everything below sits around them.

## Highlights

* **Dark theme** with a *Display* menu (match system / light / dark, row density); every colour is a design token and there is no flash on load.
* **Faster investigations:** previous/next through the list you came from, a breadcrumb that keeps your filters, per-type "what to check" guidance,
  and **Find a reference** (`/`) which answers "what happened to PAY-…?" even for payments that matched.
* **Overview that supports triage:** break ageing buckets linked to the filtered queue, recent activity, and failed runs shown even after a good run.
* **An audit log you can read:** sentences with display names; the raw action code and JSON remain as technical detail.
* **Upload:** real byte progress, downloadable templates (verified by a test), clear pre-checks.
* **Phones:** tables become labelled cards.
* **Accessibility:** defects found with axe-core and keyboard testing fixed; WCAG 2.2 target size and focus-not-obscured now tested.
* **Ten deterministic data scenarios** at four sizes, each with an expected outcome constructed at generation time (`npm run demo:scenarios`).

## Verification

218 automated tests (113 unit, 74 integration on PostgreSQL, 31 in Chrome), all passing locally on macOS and in GitHub Actions (PostgreSQL 17, Ubuntu).
Performance re-measured on an Apple M4: [docs/performance.md](../performance.md). Everything not verified (screen readers, Safari, Firefox) is listed in [audit.md](audit.md).

## Upgrading

`npm install && npm run migrate` (adds migration 0006: three indexes). No data migration; no configuration changes. New dev dependency: `axe-core`.

Full details: [CHANGELOG.md](../../CHANGELOG.md).
