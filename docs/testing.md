# Testing

Everything uses Node's built-in test runner (`node:test`) and `fetch`; the only test-time dependency is
`playwright-core`, used to drive an already-installed Chrome (no browser download).

| Layer | Location | What it proves | Needs |
|---|---|---|---|
| Unit | `test/unit` | money parsing/formatting, exact fee rounding (including an exact-arithmetic sweep), IST date rules, CSV structure and row validation, every engine rule and precedence, determinism, permissions, passwords, config, sort whitelist, the demo data and the whole **scenario library** against constructed ground truth plus engine invariants (see below), the downloadable CSV templates | nothing |
| Integration | `test/integration` | HTTP + real PostgreSQL: auth, sessions, CSRF, uploads, duplicates (including races), runs, worker claiming/retry/crash recovery/lease loss, settings versioning, break queue filters, maker-checker (including concurrent decisions), audit, exports, database constraints with the service layer bypassed, every scenario end to end, the trace/overview/audit-filter endpoints, and **migrations on an empty database** (ordered, idempotent, concurrent, tamper detection, clean-install guarantees) | PostgreSQL |
| End-to-end | `test/e2e` | A real browser. `browser.test.js`: the full journey analyst → supervisor → auditor, login failure, phone layout. `workflows.test.js`: empty states per role, filters/chips/sorting/pagination, queue navigation and shortcuts, reference search, theme persistence and no-flash, density, every upload failure mode, queued and failed run states, per-role controls, two-step confirmations, API outage and session expiry. `accessibility.test.js`: axe-core on every screen in light and dark, desktop and phone, keyboard behaviour, reduced motion, zoom reflow | PostgreSQL + Chrome |

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

## Scenarios, ground truth and invariants

[`scripts/lib/scenario-library.js`](../scripts/lib/scenario-library.js) builds data **and** the expected outcome, counted as each situation is injected;
the engine is never used to produce an expectation ([data-scenarios.md](data-scenarios.md)). `test/unit/scenarios.test.js` runs every scenario at
small, normal and large sizes (two at xl) through the real parsers and engine and requires an exact match, then checks properties that must hold on any
data: every ledger entry and settlement line gets exactly one result; a `MATCHED` pair really has equal amounts, the same reference and direction and an in-tolerance fee;
every `AMOUNT_MISMATCH` really differs and records settlement minus ledger; batch totals are computed from the batch's own lines; results are repeatable and
independent of input order; advancing the as-of date only turns pending items into missing-in-settlement breaks; a stricter fee tolerance reports strictly more.
These are hand-written seeded property tests rather than a property-testing library: the generators already exist, and a library would add a dependency without adding coverage.
A deliberate mutation of the generator fails them (checked while writing).

## Accessibility testing

`accessibility.test.js` runs axe-core (WCAG 2.0, 2.1 and 2.2 A/AA rules plus best practices) on every screen for the supervisor in light and dark on a desktop and on a phone, on the
login screen, with the Display menu open and with a decision dialog open, and on the restricted views of the analyst and auditor. Zero violations are tolerated. Automated rules find only some problems, so the same file also asserts keyboard behaviour (skip link is the first tab stop,
one tab stop per table row, menu and dialog open/close/focus return, the `/` shortcut ignores typing), reduced motion, and reflow at 720 and 360 CSS px (200% and 400% zoom).
Screen readers were not run; see [refinement/audit.md](refinement/audit.md).

## Financial edge cases covered

₹0 and out-of-range amounts (the ₹1 crore cap on both signs) · ≥3 decimal places · thousands separators · negative payment vs refund sign rules ·
a one-paisa mismatch · fee at, above and below the tolerance · half-paisa fee rounding (₹0.25 at 2%) · refund with a
fee · same reference as payment and refund · repeated identical references · ambiguous references · duplicate
settlement lines with equal and different amounts · timestamps at 23:58 IST and 00:01 IST expressed in UTC · window of
0 days and the exact deadline day · late settlement turning pending into missing · repeated file upload (sequential
and concurrent) · concurrent run requests · concurrent proposals · concurrent reviewer decisions · stale-version
decisions · worker crash, lease expiry, attempt exhaustion and lease loss.

## What is not tested automatically

CI runs the same commands, but the Chrome-based tests depend on the runner's Chrome. Visual quality was
reviewed by hand in Chrome (1440, 820 and 390 px, light and dark); there are no screenshot-diff tests. There is no load
test beyond `npm run bench` ([performance](performance.md)). No assistive technology (screen reader, switch device) was used: only axe-core and keyboard checks.
