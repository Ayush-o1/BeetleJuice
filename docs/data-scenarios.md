# Synthetic data scenarios

BeetleJuice ships a deterministic scenario library so a reviewer can see the product with many different kinds of day,
and so tests can check the reconciliation engine against ground truth that did **not** come from the engine.
Everything is fictional: merchants, references and the processor ("NimbusPay") are invented, and no real card or account data exists.

## How it works

[`scripts/lib/scenario-library.js`](../scripts/lib/scenario-library.js) builds the two CSV files and, at the same time,
the expected outcome. Each situation is counted **when it is injected** ("this pair is a clean match", "this settlement
line is a duplicate"). The engine is never consulted to produce the expectation.

* **Deterministic.** A scenario is fully determined by `(name, size, seed)`. No clock, no `Math.random`; the same
  arguments give byte-identical files on any machine.
* **Valid by construction.** Amounts are integer paise, fees use the production rounding rule (half-up on the configured
  2%), refunds are negative on the settlement side with no fee, batch totals are the sums of their own lines, timestamps carry an
  IST or UTC offset, and every reference is unique unless a scenario deliberately repeats it.
* **Judged as of 2026-11-08** with default settings: 2-day settlement window, 2.0000% fee, ±1 paisa fee tolerance,
  no amount tolerance.

## Sizes

`size` sets the number of primary items; rows per file are slightly higher because of batch rows, duplicates and invalid rows.

| Size | Primary items | Intended use |
|---|---:|---|
| `small` | 10 | Readable by eye. These are committed in [`demo-data/scenarios/`](../demo-data/scenarios/README.md). |
| `normal` | 150 | A realistic working day; the sensible default for demos. |
| `large` | 1,500 | Paging, filtering and ageing with a few thousand rows. |
| `xl` | 15,000 | Stress. Stays under the default 50,000-row upload limit. |

The separate [benchmark](performance.md) goes further (about 45,000 rows per file) by writing rows straight to its own database.

## Scenarios

| Scenario | What it demonstrates |
|---|---|
| `clean-day` | Almost everything matches: ordinary payments, some refunds, a handful still inside the settlement window, and two payments on the IST midnight boundary. The reference case for a healthy day. |
| `missing-settlements` | The processor file is short: a meaningful share of ledger entries older than the settlement window never settled, plus a few that are still pending and a couple of orphan settlement lines. |
| `duplicate-references` | The processor lists some payments twice (duplicate settlement), a customer legitimately pays twice under one reference (both pairs match), and a few references are genuinely ambiguous (two ledger amounts, one settlement amount). |
| `fee-variances` | Fees diverge from the configured 2%: over- and under-charges well past the tolerance, and exact ±1 paisa differences that must NOT be reported. Includes the exact boundary (+1 ok, +2 break). |
| `late-settlements` | Tests the settlement window precisely: unsettled entries at every age from today back to 7 days (pending inside the window, missing outside), and payments that did settle, but 3–5 days late (still matched). |
| `refund-heavy` | A promotion reversal: about a third of the activity is refunds (negative settlement amounts, no fee). Includes refunds settled for the wrong amount and refunds the processor paid that the ledger never recorded. |
| `multi-batch` | Each settlement day is paid out in four batches. Every batch total is consistent with its lines, so all batches reconcile; transaction-level outcomes are unaffected by how lines are grouped. |
| `invalid-rows` | About one row in ten is malformed in both files (zero or malformed amounts, wrong currency, missing timestamp offset, missing reference, unknown entry type, refunds with the wrong sign, impossible dates, repeated line ids, fee above amount). Valid rows reconcile normally. |
| `break-storm` | A bad day: roughly four in ten transactions need attention across every transaction break type, and two batches are short on payout. Stress for the break queue, filters and pagination. |
| `batch-payout-difference` | Every transaction matches, but two payout batches disagree with their own lines: one short on payout, one with a declared gross that is too high. The break is entirely at batch level. |

Rows per file and expected outcome by size (ledger rows / settlement rows · matched **m**, pending **p**, breaks **b**):

| Scenario | small | normal | large |
|---|---|---|---|
| `clean-day` | 19 / 24 · 18m 1p 0b | 167 / 168 · 162m 5p 0b | 1597 / 1558 · 1552m 45p 0b |
| `missing-settlements` | 12 / 17 · 10m 1p 2b | 174 / 159 · 150m 6p 21b | 1740 / 1536 · 1500m 60p 210b |
| `duplicate-references` | 15 / 25 · 13m 0p 4b | 178 / 199 · 172m 0p 21b | 1770 / 1872 · 1710m 0p 210b |
| `fee-variances` | 17 / 22 · 16m 0p 1b | 181 / 187 · 163m 0p 18b | 1760 / 1766 · 1580m 0p 180b |
| `late-settlements` | 18 / 14 · 10m 3p 5b | 190 / 155 · 150m 15p 25b | 1860 / 1505 · 1500m 135p 225b |
| `refund-heavy` | 12 / 17 · 10m 1p 2b | 161 / 165 · 150m 5p 9b | 1605 / 1596 · 1500m 45p 90b |
| `multi-batch` | 12 / 21 · 10m 1p 1b | 160 / 179 · 150m 5p 5b | 1590 / 1569 · 1500m 45p 45b |
| `invalid-rows` | 13 / 17 · 10m 1p 1b | 173 / 174 · 150m 5p 3b | 1725 / 1686 · 1500m 45p 30b |
| `break-storm` | 13 / 21 · 7m 1p 10b | 147 / 150 · 92m 6p 73b | 1455 / 1377 · 915m 60p 692b |
| `batch-payout-difference` | 10 / 18 · 10m 0p 2b | 150 / 168 · 150m 0p 2b | 1500 / 1518 · 1500m 0p 2b |

The exact expected breakdown for each committed set is in its `expected.json` and README under `demo-data/scenarios/`.

## Using them

```bash
npm run demo:scenarios -- --list                         # describe every scenario
npm run demo:scenarios                                   # regenerate the committed small sets
npm run demo:scenarios -- --scenario break-storm --size large --seed 7 --out /tmp/storm

# load one straight into a disposable dev database (same guards as demo:reset), with the run already completed
npm run demo:reset -- --yes --scenario multi-batch --size normal
```

Or upload the CSVs from the UI (Sources → Upload file), start a run with as-of date 2026-11-08, and compare the Run page with
`expected.json`.

## How they are tested

* [`test/unit/scenarios.test.js`](../test/unit/scenarios.test.js) runs every scenario at `small`, `normal` and `large` (and two at `xl`) through the
  real parsers and the real engine and requires the constructed expectation to match exactly: accepted/rejected rows and their
  error codes, matched, pending, every break type, and which batches are broken. It also checks that the committed files are
  not stale.
* The same file asserts engine invariants over the generated data: every record gets exactly one result, a match really has equal
  amounts and an in-tolerance fee, no amount difference is silently matched, batch results use the batch's own lines, results are repeatable and independent of
  input order, and advancing the as-of date only turns pending items into missing-in-settlement breaks.
* [`test/integration/scenarios.test.js`](../test/integration/scenarios.test.js) pushes each scenario through HTTP upload, PostgreSQL, the worker and the API.

A deliberate mutation of the generator (changing the fee tolerance boundary) fails these tests, which is how we know they are not vacuous.

## The original November demo

`npm run demo:generate` and `demo-data/*.csv` are unchanged: a single mixed 330-row day with 40 breaks, used by the
README walkthrough and by `npm run demo:reset -- --yes --load-sample`. See [demo-guide.md](demo-guide.md).
