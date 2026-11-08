# Files with invalid CSV rows

`invalid-rows` · size `small` · seed `20261108` · as of **2026-11-08** · default settings (2-day window, 2.0000% fee, ±1 paisa fee tolerance, no amount tolerance)

About one row in ten is malformed in both files (zero or malformed amounts, wrong currency, missing timestamp offset, missing reference, unknown entry type, refunds with the wrong sign, impossible dates, repeated line ids, fee above amount). Valid rows reconcile normally.

| | Rows | Accepted | Rejected |
|---|---:|---:|---:|
| `ledger.csv` | 13 | 12 | 1 |
| `settlement.csv` | 17 | 16 | 1 |

Expected: **10** matched, **1** awaiting settlement, **1** transaction breaks, **0** of 5 batches broken (1 breaks in total).

* AMOUNT_MISMATCH: 1

Rejected-row codes: ledger AMOUNT_ZERO; settlement AMOUNT_SIGN.

Generated; do not edit. `expected.json` is what the reconciliation engine must reproduce (checked by `test/unit/scenarios.test.js`).
