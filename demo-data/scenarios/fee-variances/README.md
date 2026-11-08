# Multiple fee variances

`fee-variances` · size `small` · seed `20261108` · as of **2026-11-08** · default settings (2-day window, 2.0000% fee, ±1 paisa fee tolerance, no amount tolerance)

Fees diverge from the configured 2%: over- and under-charges well past the tolerance, and exact ±1 paisa differences that must NOT be reported. Includes the exact boundary (+1 ok, +2 break).

| | Rows | Accepted | Rejected |
|---|---:|---:|---:|
| `ledger.csv` | 17 | 17 | 0 |
| `settlement.csv` | 22 | 22 | 0 |

Expected: **16** matched, **0** awaiting settlement, **1** transaction breaks, **0** of 5 batches broken (1 breaks in total).

* FEE_VARIANCE: 1

Generated; do not edit. `expected.json` is what the reconciliation engine must reproduce (checked by `test/unit/scenarios.test.js`).
