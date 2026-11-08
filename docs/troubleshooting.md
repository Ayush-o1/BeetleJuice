# Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `npm run db:create` or the app fails with `ECONNREFUSED` / `role … does not exist` | PostgreSQL is not running, or `DATABASE_URL` needs a user and password. Check with `psql "$DATABASE_URL" -c "select 1"`. Homebrew installs usually need no password; others use `postgres://user:pass@localhost:5432/beetlejuice_dev`. |
| App exits at start with a list of invalid settings | Configuration is validated at start-up; the message names each bad variable. Compare with `.env.example`. In production `SCRYPT_LOG2_N` must be ≥ 17 and `COOKIE_SECURE` should be on. |
| `Migration … was modified after being applied` | An applied migration file was edited. Restore it from git and add a **new** migration instead. |
| `demo:reset` says "Refusing to reset" | Intentional guards: `NODE_ENV` must not be `production`, `ALLOW_DEMO_RESET=true`, the database name must end in `_dev`, `_demo` or `_test`, and `--yes` is required. |
| Sign-in fails for demo users | They only exist after `demo:reset`. Password `BeetleJuice-Demo-2026` (development only). Five failures lock an account for 15 minutes; 20 sign-ins per 15 minutes per IP are allowed (restart the dev server to clear the in-memory limiter). |
| "Your session has ended" | Sessions expire after 30 minutes idle or 8 hours total. Sign in again; nothing was lost. |
| A run stays *Queued* | No worker is running. With `WORKER_IN_PROCESS=true` (default) the web process runs it; if you set it to `false`, start `npm run worker`. A crashed worker's run is reclaimed after the lease (`RUN_LEASE_SECONDS`). |
| A run is *Failed* | The run page shows the error code and message and how many attempts were used. Start it again from the link; identical inputs and settings that already completed are refused as duplicates. |
| Upload says "already uploaded" | Identical bytes of the same kind exist (SHA-256), whatever the file is called. Use *Open the original*. |
| Upload says the header is wrong | The message lists missing, unexpected and duplicated columns. **Download a template** on the upload panel shows the exact header. Column order does not matter; names are case-insensitive. |
| Rows are rejected | The report lists row, field, reason code and the original text. Fix those rows and upload the corrected file (it is a different file, so it is accepted). |
| `npm test` skips or fails the browser tests | They need Google Chrome (`channel: 'chrome'`). Without it they skip loudly. Integration tests need PostgreSQL and a database named `…_test` (`TEST_DATABASE_URL`). |
| Migration test fails with a permission error | `test/integration/migrations.test.js` creates and drops `beetlejuice_migrations_test`; the test user needs `CREATEDB`. |
| `npm run screenshots` cannot sign in | The demo users must exist (`demo:reset … --load-sample`) and the app must be running on `BASE_URL` (default http://localhost:3000). |
| The page looks unstyled or the theme flashes | The browser cached an old asset; hard-reload. A proxy that rewrites the CSP can block `/js/theme-init.js` (it must be allowed by `script-src 'self'`). |
