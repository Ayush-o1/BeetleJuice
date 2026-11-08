# One batch pays out the wrong amount

`batch-payout-difference` · size `small` · seed `20261108` · as of **2026-11-08** · default settings (2-day window, 2.0000% fee, ±1 paisa fee tolerance, no amount tolerance)

Every transaction matches, but two payout batches disagree with their own lines: one short on payout, one with a declared gross that is too high. The break is entirely at batch level.

| | Rows | Accepted | Rejected |
|---|---:|---:|---:|
| `ledger.csv` | 10 | 10 | 0 |
| `settlement.csv` | 18 | 18 | 0 |

Expected: **10** matched, **0** awaiting settlement, **0** transaction breaks, **2** of 8 batches broken (2 breaks in total).

* BATCH_PAYOUT_MISMATCH: 2

Generated; do not edit. `expected.json` is what the reconciliation engine must reproduce (checked by `test/unit/scenarios.test.js`).
