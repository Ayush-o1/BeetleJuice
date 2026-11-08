# Clean settlement day

`clean-day` · size `small` · seed `20261108` · as of **2026-11-08** · default settings (2-day window, 2.0000% fee, ±1 paisa fee tolerance, no amount tolerance)

Almost everything matches: ordinary payments, some refunds, a handful still inside the settlement window, and two payments on the IST midnight boundary. The reference case for a healthy day.

| | Rows | Accepted | Rejected |
|---|---:|---:|---:|
| `ledger.csv` | 19 | 19 | 0 |
| `settlement.csv` | 24 | 24 | 0 |

Expected: **18** matched, **1** awaiting settlement, **0** transaction breaks, **0** of 6 batches broken (0 breaks in total).

* no breaks

Generated; do not edit. `expected.json` is what the reconciliation engine must reproduce (checked by `test/unit/scenarios.test.js`).
