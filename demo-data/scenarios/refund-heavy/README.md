# Refund-heavy day

`refund-heavy` · size `small` · seed `20261108` · as of **2026-11-08** · default settings (2-day window, 2.0000% fee, ±1 paisa fee tolerance, no amount tolerance)

A promotion reversal: about a third of the activity is refunds (negative settlement amounts, no fee). Includes refunds settled for the wrong amount and refunds the processor paid that the ledger never recorded.

| | Rows | Accepted | Rejected |
|---|---:|---:|---:|
| `ledger.csv` | 12 | 12 | 0 |
| `settlement.csv` | 17 | 17 | 0 |

Expected: **10** matched, **1** awaiting settlement, **2** transaction breaks, **0** of 5 batches broken (2 breaks in total).

* AMOUNT_MISMATCH: 1
* MISSING_IN_LEDGER: 1

Generated; do not edit. `expected.json` is what the reconciliation engine must reproduce (checked by `test/unit/scenarios.test.js`).
