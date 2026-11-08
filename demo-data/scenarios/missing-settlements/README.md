# Several missing settlements

`missing-settlements` · size `small` · seed `20261108` · as of **2026-11-08** · default settings (2-day window, 2.0000% fee, ±1 paisa fee tolerance, no amount tolerance)

The processor file is short: a meaningful share of ledger entries older than the settlement window never settled, plus a few that are still pending and a couple of orphan settlement lines.

| | Rows | Accepted | Rejected |
|---|---:|---:|---:|
| `ledger.csv` | 12 | 12 | 0 |
| `settlement.csv` | 17 | 17 | 0 |

Expected: **10** matched, **1** awaiting settlement, **2** transaction breaks, **0** of 6 batches broken (2 breaks in total).

* MISSING_IN_LEDGER: 1
* MISSING_IN_SETTLEMENT: 1

Generated; do not edit. `expected.json` is what the reconciliation engine must reproduce (checked by `test/unit/scenarios.test.js`).
