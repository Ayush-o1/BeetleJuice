# Testing

Everything uses Node's built-in test runner (`node:test`) and `fetch`; the only test-time dependency is
`playwright-core`, used to drive an already-installed Chrome (no browser download).

| Layer | Location | What it proves | Needs |
|---|---|---|---|
| Unit | `test/unit` | money parsing/formatting, exact fee rounding, IST date rules, CSV structure and row validation, every engine rule and precedence, determinism, one-outcome-per-record invariant (200 seeded random cases), permissions, passwords, config, sort whitelist, demo data ground truth | nothing |
| Integration | `test/integration` | HTTP + real PostgreSQL: auth, sessions, CSRF, uploads, duplicates (including races), runs, worker claiming/retry/crash recovery/lease loss, settings versioning, break queue filters, maker-checker (including concurrent decisions), audit, exports, database constraints with the service layer bypassed | PostgreSQL |
| End-to-end | `test/e2e` | A real browser: analyst uploads, runs, investigates and proposes; supervisor approves; auditor inspects; role restrictions; login failure; phone layout has no horizontal scroll; no unexpected console errors | PostgreSQL + Chrome |

## Running

```bash
npm test                    # everything (files run one at a time: they share one test database)
npm run test:unit
npm run test:integration
npm run test:e2e            # skips, loudly, if Chrome cannot be launched
npm run lint                # syntax check of every JS file
```

The test database defaults to `postgres://localhost:5432/beetlejuice_test` (`TEST_DATABASE_URL` overrides).
The helper creates the schema by running the real migrations and **refuses any database whose name does not end
in `_test`**. Between tests it truncates all tables (lifting the audit table's TRUNCATE guard only there) and
re-seeds five users with a fast scrypt cost.

## Test data

* `test/helpers/scenario.js` is a hand-computed 8-row scenario whose every outcome is written next to the data.
* `scripts/lib/demo-data.js` generates the larger demo files *and the ground truth it constructed*;
  `test/unit/demo-data.test.js` runs the real parsers and engine against it and fails on any difference.
  It also checks that the committed `demo-data/*.csv` equal the generator's output.

## Financial edge cases covered

₹0 and out-of-range amounts · ≥3 decimal places · thousands separators · negative payment vs refund sign rules ·
a one-paisa mismatch · fee at, above and below the tolerance · half-paisa fee rounding (₹0.25 at 2%) · refund with a
fee · same reference as payment and refund · repeated identical references · ambiguous references · duplicate
settlement lines with equal and different amounts · timestamps at 23:58 IST and 00:01 IST expressed in UTC · window of
0 days and the exact deadline day · late settlement turning pending into missing · repeated file upload (sequential
and concurrent) · concurrent run requests · concurrent proposals · concurrent reviewer decisions · stale-version
decisions · worker crash, lease expiry, attempt exhaustion and lease loss.

## What is not tested automatically

CI runs the same commands, but the Chrome-based tests depend on the runner's Chrome. Visual quality was
reviewed by hand in Chrome at 1440 px and 390 px widths; there are no screenshot-diff tests. There is no load
test beyond `npm run bench` ([performance](performance.md)).
