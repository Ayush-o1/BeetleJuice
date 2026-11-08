# Unusually many breaks

`break-storm` · size `small` · seed `20261108` · as of **2026-11-08** · default settings (2-day window, 2.0000% fee, ±1 paisa fee tolerance, no amount tolerance)

A bad day: roughly four in ten transactions need attention across every transaction break type, and two batches are short on payout. Stress for the break queue, filters and pagination.

| | Rows | Accepted | Rejected |
|---|---:|---:|---:|
| `ledger.csv` | 13 | 13 | 0 |
| `settlement.csv` | 21 | 21 | 0 |

Expected: **7** matched, **1** awaiting settlement, **8** transaction breaks, **2** of 9 batches broken (10 breaks in total).

* AMOUNT_MISMATCH: 1
* DUPLICATE_SETTLEMENT: 1
* MISSING_IN_LEDGER: 1
* MISSING_IN_SETTLEMENT: 1
* BATCH_PAYOUT_MISMATCH: 2
* FEE_VARIANCE: 1
* AMBIGUOUS_REFERENCE: 3

Generated; do not edit. `expected.json` is what the reconciliation engine must reproduce (checked by `test/unit/scenarios.test.js`).
