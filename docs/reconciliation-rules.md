# Reconciliation rules

The engine ([`src/modules/engine`](../src/modules/engine)) is a pure function: the same inputs and the same
configuration always give the same output. It uses **passes**. Each pass only sees records that earlier passes
did not claim, so the order below *is* the precedence.

## Inputs and configuration

Per run: one ledger file, one settlement file, and a frozen configuration:

| Setting | Default | Meaning |
|---|---|---|
| `settlementWindowDays` | 2 | Calendar days after the recorded business date an entry may stay unsettled |
| `amountTolerancePaise` | 0 | Largest amount difference still treated as a match |
| `feeRatePercent` | 2.0000 | Expected fee rate, up to 4 decimals |
| `feeTolerancePaise` | 1 | Largest fee difference not reported |
| `asOfDate` | latest date in either file | The business date the run is judged on |

Business dates are IST calendar dates. Window arithmetic uses calendar days (no bank-holiday calendar).

## The match key and why it is not just "reference"

`key = (reference upper-cased, direction)`. A reference is **not** unique across all input: a payment and its
refund may share one, a customer can legitimately pay twice under one reference, and a processor can list a
line twice. So records are grouped by key and the passes decide how many may pair. Nothing is ever paired by
"first candidate wins" when the choice is ambiguous.

Within a key, records are ordered by (business date | settled date, file row) so "in file order" is
reproducible.

## Passes, in execution order

| # | Rule | Claims | Outcome |
|---|---|---|---|
| 1 | **R01** Exact reference and amount | Pairs with identical amount: for each distinct amount, `min(ledger count, settlement count)` pairs in file order. Then, if tolerance > 0 and exactly one ledger and one settlement record remain for the key, they pair when `|difference| ≤ tolerance`. | `MATCHED` (but see R08) |
| 2 | **R02** Amount mismatch | Exactly one unpaired record on each side for the key. | `BREAK AMOUNT_MISMATCH`, difference = settlement − ledger |
| 3 | **R09** Ambiguity guard | Anything still unpaired with records on **both** sides (so not 1:1). | `BREAK AMBIGUOUS_REFERENCE` for *every* involved record |
| 4 | **R03** Duplicate settlement | Settlement lines left over when the ledger side is exhausted *and* the key already had an R01 pair. | `BREAK DUPLICATE_SETTLEMENT` per extra line |
| 5 | **R04** Pending | Unpaired ledger entry, no settlement line left, and `asOfDate ≤ businessDate + windowDays`. | `PENDING` (not a break) |
| 6 | **R05** Missing in ledger | Settlement line whose key has no ledger record at all. | `BREAK MISSING_IN_LEDGER` |
| 7 | **R06** Missing in settlement | Unpaired ledger entry past its window. | `BREAK MISSING_IN_SETTLEMENT` |
| 8 | **R07** Batch payout | Per batch, over all of that batch's lines (see below). | batch `MATCHED` or `BREAK BATCH_PAYOUT_MISMATCH` |
| 9 | **R08** Fee variance | Applied to every R01 pair: expected fee vs charged fee. | `MATCHED` stays, or becomes `BREAK FEE_VARIANCE` |

R09 sits between R02 and R03 deliberately: the cases R03/R05 handle (surplus on exactly one side) must be
distinguished from "both sides have leftovers that don't line up", which cannot be resolved without guessing.

Every ledger entry and every settlement line ends in **exactly one** result per run. The engine's invariant
test checks this over 200 seeded random inputs, and a partial unique index on `match_results` makes it
impossible to store otherwise.

## Rule details and examples

**R01.** `PAY-1` ledger ₹5,000.00 / settlement ₹5,000.00 → matched. A reference that appears twice on both
sides with identical amounts pairs in file order and the explanation says so. Two ledger entries of ₹450 and
one settlement of ₹450: one pairs; the other goes to R04/R06 (it has no settlement).

**R02.** Ledger ₹1,200.00 vs settlement ₹1,250.00 → `AMOUNT_MISMATCH`, difference +₹50.00. A one-paisa
difference is a mismatch unless the tolerance allows it. Fees are not checked on a mismatched pair (which
amount should the fee be computed on is itself the open question).

**R09.** Ledger ₹100 and ₹200 for `PAY-7`, settlement ₹150 → all three records become `AMBIGUOUS_REFERENCE`;
the explanation lists the candidate ids. Likewise ledger ₹100 vs settlement ₹150 + ₹150: ambiguous, not "one
mismatch plus one duplicate".

**R03.** One ledger entry, settlement lines `S1` and `S2` both ₹800 → `S1` matches (earliest), `S2` is a
duplicate. A *second* line with a **different** amount for an already-settled reference is also a
duplicate (the ledger accounts for one settlement), and its amount is shown. The batch pass still counts
both lines, because the processor listed both and presumably paid them: the duplicate is a transaction-level
problem, not a batch-total problem.

**R04 / R06.** Recorded 6 Nov, window 1 day → deadline 7 Nov. As of 6 or 7 Nov it is pending; as of 8 Nov it
is `MISSING_IN_SETTLEMENT`. A window of 0 means pending only on the recording day. Results never mutate: run
again with a later as-of date or a newer settlement file and the entry is re-evaluated.

**R05.** Settlement line for `PAY-9009` with no ledger record at all.

**R07 — batch payout.** From the settlement *lines* of batch B:

```
computed gross = Σ line amount          (sales +, refunds −)
computed fees  = Σ line fee              (as charged)
expected net   = gross − fees
```

Compared **exactly** (no tolerance; a payout is a real transfer) with the declared `batch_gross`, `batch_fee`,
`batch_payout`. Any of the three differing is one batch break, and the explanation names which. A batch with
lines but no summary row, or a summary row with no lines, is also a break. Each line belongs to exactly one
batch (its `batch_id`), so nothing is counted twice, and no subset-sum search is needed because batch
identifiers are given. The batch result also records the fee the configured rate would have produced
(`rateExpectedFeesPaise`) for context.

**R08 — fee variance.** `expected = round_half_up(amount × rate / 100)` for sales; `0` for refunds. A pair is
a break when `|charged − expected| > feeTolerance`. Rounding is half-up (away from zero) on exact rationals:
₹0.25 at 2% is 0.5 paise → 1 paisa. See `src/lib/rate.js` for the single implementation.

## Amount-at-issue ("impact")

Used for ranking and the amount-range filter: |difference| for mismatch, fee variance and batch breaks; the
record's own amount for missing, duplicate and ambiguous breaks.

## Ageing

Each break stores a `reference_date` (ledger business date for ledger-side problems, settled date for
settlement-side ones, batch settled date for batches). Displayed **age** = today (IST) − reference date for
unresolved breaks, frozen at the resolution date once resolved. **Age at run** = run as-of date − reference
date, frozen at execution. Both are shown on the break page.

## Known limits

* One-to-one pairing by reference only; no fuzzy matching of typos (they surface as two breaks).
* Calendar days, no holiday calendar; single fee rate for all merchants.
* A later run is independent: breaks are not carried over or de-duplicated across runs.
