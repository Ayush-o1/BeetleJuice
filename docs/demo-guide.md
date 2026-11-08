# Demo guide

A ten-minute walkthrough using the synthetic files in `demo-data/`. Everything is fictional.

## Setup

```bash
npm install && cp .env.example .env
npm run db:create && npm run migrate
npm run dev                       # http://localhost:3000
```

Create the demo accounts (and optionally pre-load a finished run with a few proposals):

```bash
ALLOW_DEMO_RESET=true npm run demo:reset -- --yes                  # users only: start the walkthrough from scratch
ALLOW_DEMO_RESET=true npm run demo:reset -- --yes --load-sample    # users + sample data + run + 4 proposals
```

`demo:reset` **drops the schema of the database in `DATABASE_URL`**. It refuses unless `NODE_ENV` is not
production, `ALLOW_DEMO_RESET=true`, the database name ends in `_dev`, `_demo` or `_test`, and `--yes` is given.

| Username | Role | Password (development only) |
|---|---|---|
| `analyst`, `analyst2` | Reconciliation Analyst (maker) | `BeetleJuice-Demo-2026` |
| `supervisor`, `supervisor2` | Reconciliation Supervisor (checker) | `BeetleJuice-Demo-2026` |
| `auditor` | Auditor (read-only) | `BeetleJuice-Demo-2026` |

This password is public by design. Never create these accounts anywhere real.

## Pick a day to look at

The original walkthrough below uses one mixed November file pair. For other situations (a clean day, missing settlements,
duplicate references, fee variances, late settlements, refund-heavy, multi-batch, invalid rows, a break storm, or only a
wrong payout) load a generated scenario in one command, or upload its CSVs yourself:

```bash
npm run demo:scenarios -- --list
ALLOW_DEMO_RESET=true npm run demo:reset -- --yes --scenario break-storm --size normal
```

Each scenario's expected outcome is documented in [data-scenarios.md](data-scenarios.md) and in `demo-data/scenarios/<name>/expected.json`.

## Walkthrough (from the "users only" reset)

1. **Sign in as `analyst`.** The overview says there is no data yet. Nothing on it is a placeholder.
2. **Sources → Upload file.** Upload `demo-data/ledger-2026-11.csv` as *Internal ledger*. The report shows
   334 rows, 330 accepted, **4 rejected**, each with row number, field, reason and the original row (zero amount,
   USD, three decimals, timestamp without offset).
3. Upload `demo-data/nimbuspay-settlement-2026-11.csv` as *Processor settlement*: 327 rows, 324 accepted,
   3 rejected (refund with positive sign, repeated line id, impossible date).
   Before uploading you can use **Download a template** for a tiny valid example of each type. While a larger file goes up, the bar shows real bytes sent, then "Validating every row…" (no percentage is invented for the validation step).
4. Upload the ledger again → **"This file was already uploaded"** (SHA-256 + a unique index; renaming the file does not help).
5. **Runs → New run.** The as-of date defaults to 2026-11-08; the panel shows the settings that will be frozen
   into the run. Start it. The run page shows queued → running → completed.
6. **Read the result** (see [expected-outcomes.md](../demo-data/expected-outcomes.md)): 291 matched, 14 awaiting
   settlement, 38 transaction breaks, 2 of 6 batches broken. Open *Configuration used*: settings v1, input hashes.
7. **Breaks.** Filter by type *Duplicate settlement*, sort by amount, open one. Compare the two records, read the
   rule (R03) and the explanation, see the batch context. Expand **What to check** for where to look next. Use **Previous / Next** (or `[` and `]`) to step through the list you came from; the breadcrumb returns to the same filters.
   On the **Overview**, click a row of *How old are they?* to open the queue filtered to that age band.
8. **Investigate an amount mismatch** (e.g. the ₹50.00 one): add a note; propose *Correct the ledger* with an
   explanation → confirm. The break becomes *Awaiting review*, and the timeline shows who did what.
9. **Sign out, sign in as `supervisor`.** The Review queue shows a count. Open the proposal; **Approve** (optional
   comment) or **Reject** (reason required). Try it from `analyst` first: there is no Approve button, and the API
   returns 403 if you call it.
10. **Concurrency:** open the same pending proposal as `supervisor` and `supervisor2` in two browsers; decide in both.
    One succeeds; the other gets *"This break changed…"* (409) and the page reloads.
11. **Settings (supervisor).** Change the settlement window to 5 days and save. The old run still shows v1.
    Start a new run on the same files: now it has settings v2 and the "missing in settlement" breaks are pending
    instead (the pending → break transition is driven by the window and as-of date).
12. **Sign in as `auditor`.** Audit log: filter by `proposal.` or a break id; export CSV. Every page is read-only:
    no upload button, no forms, disabled settings, and write APIs answer 403.

## Finding any reference

Press `/` anywhere (or use the box at the top), type a reference such as `pay-2611-00296` and press Enter. You get every ledger entry and settlement line that
carries it and what each completed run decided about it, whether it matched or not. Try `PAY-AMB-001` (ambiguous) and a made-up reference (the empty state explains what that means).

## Themes and density

*Display* (top bar) switches between *Match system*, *Light* and *Dark*, and between comfortable and compact table rows. The choice is remembered in the browser.

## Showing "pending becomes missing"

Create a second run with the same files and `asOfDate` = 2026-11-12 (or raise the window then lower it): all 14
pending entries are now `MISSING_IN_SETTLEMENT` breaks. Nothing from run #1 changed.

## Postman / curl

Log in (`POST /api/auth/login`), keep the cookie and send `X-CSRF-Token` from the response on every write.
Upload with *Body → binary*, `Content-Type: text/csv`, `X-Filename: ledger.csv`. Full list in [api.md](api.md).
