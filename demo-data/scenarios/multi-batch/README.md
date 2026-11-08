# Multiple payout batches

`multi-batch` · size `small` · seed `20261108` · as of **2026-11-08** · default settings (2-day window, 2.0000% fee, ±1 paisa fee tolerance, no amount tolerance)

Each settlement day is paid out in four batches. Every batch total is consistent with its lines, so all batches reconcile; transaction-level outcomes are unaffected by how lines are grouped.

| | Rows | Accepted | Rejected |
|---|---:|---:|---:|
| `ledger.csv` | 12 | 12 | 0 |
| `settlement.csv` | 21 | 21 | 0 |

Expected: **10** matched, **1** awaiting settlement, **1** transaction breaks, **0** of 10 batches broken (1 breaks in total).

* FEE_VARIANCE: 1

Generated; do not edit. `expected.json` is what the reconciliation engine must reproduce (checked by `test/unit/scenarios.test.js`).
