# Project plan and progress

This document records the baseline found at the start of the work, the delivery plan and
the verification criterion for each phase. Status is updated as phases are completed.

## Baseline (2026-11-08)

| Item | Finding |
|---|---|
| Local directory | `/Users/ayush/Desktop/BettleJuice` existed and was empty; not a git repository. The directory spelling (`Bettle`) differs from the canonical project name (`BeetleJuice`) and was left untouched. |
| GitHub repository | `Ayush-o1/BeetleJuice`, public, created the same day, **no commits, no branches, no license**. Nothing to reuse or preserve. |
| Toolchain | Node 24, npm 11, PostgreSQL 18 (Homebrew, running), git 2.54. `gh` CLI is not installed; pushes use HTTPS with the macOS keychain credential helper. |
| Database | The local PostgreSQL server hosts unrelated databases belonging to other projects. They are never touched. Two new databases were created for this project: `beetlejuice_dev` and `beetlejuice_test`. |
| Browser | Google Chrome is installed, so `playwright-core` can drive a real browser for end-to-end tests and screenshots without downloading browsers. |

## Phases

| # | Phase | Deliverable | Verified by |
|---|---|---|---|
| 0 | Reconnaissance and baseline | this document, repo foundation | `git status`, remote check, push of baseline |
| 1 | Domain analysis | `docs/domain-model.md`, `docs/reconciliation-rules.md` | rules exercised with worked scenarios in unit tests |
| 2 | Architecture and database | migrations `0001`–`0005`, `docs/architecture.md`, ADRs | migrations apply to an empty DB; constraint tests |
| 3 | Backend foundation | config, logging, errors, validation, health | server boots; invalid requests return the standard error shape |
| 4 | Authentication and roles | sessions, CSRF, scrypt, permission matrix | unit tests for permissions, integration tests per role |
| 5 | File ingestion | CSV parsers, fingerprinting, row-error report | duplicate-file, malformed-file and bad-row tests |
| 6 | Financial domain | `money`, `rate`, `dates` | boundary tests (1 paise, half-up, midnight IST) |
| 7 | Reconciliation engine | pure multi-pass engine | per-rule fixtures, determinism test, ambiguity tests |
| 8 | Background processing | run queue, lease-based claiming, retry | concurrent-claim and crashed-worker tests |
| 9 | Break management | queue API, filters, detail | filter/sort/page tests, traceability test |
| 10 | Maker-checker | proposals, decisions, concurrency | self-approval and concurrent-decision tests |
| 11 | Audit history | append-only audit, timeline, export | trigger tests; atomicity tests |
| 12–13 | Design system and frontend | `public/` vanilla JS application | browser run per role, screenshots |
| 14 | Integration journeys | browser end-to-end tests | `test/e2e` |
| 15 | Security review | `docs/security.md` | checklist against the running app |
| 16 | Performance | `scripts/benchmark.js` | measured, not asserted |
| 17–18 | Final QA and release | docs, CI, tag `v1.0.0` | clean-database setup, full suite, push |

## Key risks

| Risk | Mitigation |
|---|---|
| Matching logic that looks right but mis-pairs repeated references | Engine is a pure function with explicit passes and an ambiguity guard; one-to-one is also enforced by unique indexes on the result table. |
| Floating-point leakage into money | Amounts parsed from strings straight to integer paise; fee maths in `BigInt`; sums check `Number.isSafeInteger`. |
| Races on reviewer decisions | Row locks (`FOR UPDATE`) plus a version check plus partial unique indexes as the last line of defence. |
| Worker dies mid-run | Lease with expiry; results are written in one transaction so a crash leaves no partial output. |
| Scope creep | Monolith, five runtime dependencies besides Express, no ORM, no build step. |

## Progress log

Updated at each milestone; see git history for the detail.

- [x] Phase 0 — baseline recorded
