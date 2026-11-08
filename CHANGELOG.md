# Changelog

## v1.1.0 — 2026-11-08 

Product refinement of v1.0.0, driven by an audit of the running application ([docs/refinement/audit.md](docs/refinement/audit.md)).
Behaviour of the reconciliation engine, the workflow rules and the schema constraints is unchanged (engine version stays 1.0.0).

**Product**
* **Dark theme** with a *Display* menu (match system / light / dark, and row density). Every colour is now a design token; the theme is resolved before first paint (no flash).
* **Break investigation:** previous/next through the list you came from (`[` and `]`), a breadcrumb that keeps your filters, and per-type "what to check" guidance.
* **Find a reference** (`/`): everything known about a reference, matched or not, and how each run classified it (`GET /api/trace`, migration 0006 adds the indexes).
* **Overview:** break ageing buckets that link into the filtered queue, recent activity, and failed runs surfaced even after a good run.
* **Audit log reads as sentences** with display names; raw action code and JSON stay as technical detail; opt-in "hide sign-in activity" filter.
* **Upload:** real byte progress, downloadable starter templates (proven valid by a test), clearer pre-checks.
* **Phones:** tables become labelled cards instead of clipping columns; top-bar search fits.

**Accessibility fixes** (found by axe-core and keyboard testing): run progress is a proper list; secondary-text contrast; one tab stop per table row instead of two; links in running text underlined;
login page landmark and working skip link; focus stays under the skip link on first load; 24 px minimum target sizes; focus scrolled clear of the sticky bar.

**Data and tests**
* **Scenario library:** ten deterministic scenarios at four sizes with expected outcomes *constructed* at generation time ([docs/data-scenarios.md](docs/data-scenarios.md)); `npm run demo:scenarios`, `demo:reset --scenario`.
* Tests grew from 99 to 218: engine vs constructed truth and invariants over generated data, money/rounding/CSV edge cases, migrations on an empty database, end-to-end HTTP for every scenario, and three browser suites (journey, workflows, accessibility).
* `npm run bench` now also times the HTTP API and (`--browser`) Chrome rendering; [docs/performance.md](docs/performance.md) re-measured.
* New dev dependency: `axe-core`.

**Fixed:** pagination wrote `page=1` into the URL; "From run #1 ·" dangling separator on batch breaks; the review queue's action column was clipped at 1440 px.

**Documentation:** README rewritten around real screenshots (`npm run screenshots`), research notes, troubleshooting, ADRs 0012–0015, PR template.

## v1.0.0 — 2026-11-08

First complete release.

**Product**
* CSV ingestion for internal ledger and processor settlement exports with row-level error reports,
  SHA-256 duplicate-file rejection and content-addressed storage.
* Deterministic multi-pass reconciliation engine (R01–R09) with batch payout and fee-variance checks, an
  ambiguity guard, settlement windows and an explicit as-of date.
* Durable background runs (PostgreSQL queue, leases, retries, crash recovery) with live status in the UI.
* Break queue (filters, sorting, ageing, CSV export) and break detail with both source records and timeline.
* Maker-checker resolution workflow with optimistic version checks, row locking and database backstops.
* Append-only audit log, versioned settings, three roles enforced server-side.
* Vanilla-JS interface: overview, sources and upload report, runs, run detail, break queue/detail, review queue,
  audit log, settings; responsive, keyboard accessible, reduced-motion aware.

**Engineering**
* PostgreSQL schema with constraints, partial unique indexes and triggers; forward-only checksummed migrations.
* 99 automated tests: unit, integration (real PostgreSQL) and Chrome end-to-end.
* Deterministic synthetic data generator with constructed ground truth; guarded demo reset script.
* GitHub Actions workflow running lint and the full suite against PostgreSQL.

**Known limitations** — see the README and [docs/security.md](docs/security.md).
