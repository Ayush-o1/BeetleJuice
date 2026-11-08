# Changelog

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
