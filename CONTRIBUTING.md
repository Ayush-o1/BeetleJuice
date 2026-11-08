# Contributing to BeetleJuice

BeetleJuice is a portfolio-grade reconciliation workbench; contributions should keep it small, correct
and explainable. Read [docs/architecture.md](docs/architecture.md) first.

## Local setup

Requirements: Node.js ≥ 20.12, PostgreSQL ≥ 14 running locally.

```bash
npm install
cp .env.example .env            # then edit DATABASE_URL if your Postgres needs a user/password
npm run db:create               # creates the database named in DATABASE_URL (never drops anything)
npm run migrate
ALLOW_DEMO_RESET=true npm run demo:reset -- --yes --load-sample   # optional: demo users + data
npm run dev
```

Tests use a separate database. The default is `postgres://localhost:5432/beetlejuice_test`; override with
`TEST_DATABASE_URL`. The test helper refuses to touch a database whose name does not end in `_test`.

## Workflow

* Branch from `dev` (`feat/…`, `fix/…`, `docs/…`); open a pull request into `dev`. `main` only receives
  verified, tagged states.
* Keep a change focused. Add or update tests in the same commit as the behaviour.
* Before pushing: `npm run lint && npm test`. Both must pass; never weaken or delete a test to get green.
* Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`,
  `test:`, `docs:`, `chore:`, `refactor:`. Explain *why* in the body when it is not obvious.

## Coding standards

* **Money is integer paise.** Never use floating point for amounts; percentage fees use `BigInt` rationals
  (`src/lib/rate.js`). Add a boundary test for any new financial rule.
* **Layering:** routes parse and authorise → services hold business rules and own transactions →
  repositories hold SQL. The reconciliation engine is a pure function and must stay free of I/O and clocks.
* **Enforce invariants in the database** (constraints, unique indexes, triggers) as well as in code.
* **SQL uses bind parameters only.** Sort keys and filters are whitelisted; never interpolate user input.
* **Errors:** throw `AppError` helpers for expected failures; let unexpected ones reach the central handler.
  Never log secrets, passwords or session tokens.
* **Frontend:** vanilla ES modules, no build step, no `innerHTML` with data, no inline `style` attributes or
  scripts (the CSP forbids them). Use the tokens in `public/css/tokens.css`; do not hard-code colours.
* Comments explain *why* (business rules, concurrency, security), not what the next line does.

## Migrations

* Add `migrations/NNNN_description.sql`; never edit one that has been applied anywhere (the runner stores a
  checksum and refuses). Each file runs in its own transaction.
* Migrations must preserve data. No `DROP`/`TRUNCATE` of existing business tables.
* Test the migration against an empty database (`npm test` does this) and against a database at the
  previous version.

## Reporting security issues

Please open a private security advisory on GitHub rather than a public issue.
