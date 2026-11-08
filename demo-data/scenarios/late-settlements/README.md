# Late settlements

`late-settlements` · size `small` · seed `20261108` · as of **2026-11-08** · default settings (2-day window, 2.0000% fee, ±1 paisa fee tolerance, no amount tolerance)

Tests the settlement window precisely: unsettled entries at every age from today back to 7 days (pending inside the window, missing outside), and payments that did settle, but 3–5 days late (still matched).

| | Rows | Accepted | Rejected |
|---|---:|---:|---:|
| `ledger.csv` | 18 | 18 | 0 |
| `settlement.csv` | 14 | 14 | 0 |

Expected: **10** matched, **3** awaiting settlement, **5** transaction breaks, **0** of 4 batches broken (5 breaks in total).

* MISSING_IN_SETTLEMENT: 5

Generated; do not edit. `expected.json` is what the reconciliation engine must reproduce (checked by `test/unit/scenarios.test.js`).
