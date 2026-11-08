# Processor file with duplicate references

`duplicate-references` · size `small` · seed `20261108` · as of **2026-11-08** · default settings (2-day window, 2.0000% fee, ±1 paisa fee tolerance, no amount tolerance)

The processor lists some payments twice (duplicate settlement), a customer legitimately pays twice under one reference (both pairs match), and a few references are genuinely ambiguous (two ledger amounts, one settlement amount).

| | Rows | Accepted | Rejected |
|---|---:|---:|---:|
| `ledger.csv` | 15 | 15 | 0 |
| `settlement.csv` | 25 | 25 | 0 |

Expected: **13** matched, **0** awaiting settlement, **4** transaction breaks, **0** of 10 batches broken (4 breaks in total).

* DUPLICATE_SETTLEMENT: 1
* AMBIGUOUS_REFERENCE: 3

Generated; do not edit. `expected.json` is what the reconciliation engine must reproduce (checked by `test/unit/scenarios.test.js`).
