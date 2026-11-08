# Scenario data sets

Deterministic synthetic data (fictional merchants and a fictional processor) for demonstrating and testing BeetleJuice.
The files here are the **small** size of each scenario (about 10 primary items, small enough to read). Larger sizes are
generated on demand; see [docs/data-scenarios.md](../../docs/data-scenarios.md).

```bash
npm run demo:scenarios -- --list
npm run demo:scenarios -- --scenario break-storm --size large --seed 7 --out /tmp/storm
```

| Scenario | Ledger rows | Settlement rows | Matched | Pending | Breaks | Rejected rows |
|---|---:|---:|---:|---:|---:|---:|
| [Clean settlement day](clean-day/README.md) | 19 | 24 | 18 | 1 | 0 | 0 |
| [Several missing settlements](missing-settlements/README.md) | 12 | 17 | 10 | 1 | 2 | 0 |
| [Processor file with duplicate references](duplicate-references/README.md) | 15 | 25 | 13 | 0 | 4 | 0 |
| [Multiple fee variances](fee-variances/README.md) | 17 | 22 | 16 | 0 | 1 | 0 |
| [Late settlements](late-settlements/README.md) | 18 | 14 | 10 | 3 | 5 | 0 |
| [Refund-heavy day](refund-heavy/README.md) | 12 | 17 | 10 | 1 | 2 | 0 |
| [Multiple payout batches](multi-batch/README.md) | 12 | 21 | 10 | 1 | 1 | 0 |
| [Files with invalid CSV rows](invalid-rows/README.md) | 13 | 17 | 10 | 1 | 1 | 2 |
| [Unusually many breaks](break-storm/README.md) | 13 | 21 | 7 | 1 | 10 | 0 |
| [One batch pays out the wrong amount](batch-payout-difference/README.md) | 10 | 18 | 10 | 0 | 2 | 0 |

All sets are judged as of **2026-11-08** with the default settings. Each folder has `ledger.csv`, `settlement.csv`, an
`expected.json` (what the engine must produce, constructed rather than computed) and a short README.
