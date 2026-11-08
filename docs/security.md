# Security review

A focused review of the running application against the checklist in the project brief. "Verified by" names
the automated test that fails if the control regresses; where a control is design-only it says so.

| Area | Control | Verified by |
|---|---|---|
| Passwords | scrypt via `node:crypto`, N=2¹⁷ r=8 p=1 in production (OWASP minimum), 16-byte random salt, parameters stored per hash; production refuses a lower N | `security.test.js` |
| Login | Generic failure message; unknown-user path runs a dummy hash (no timing/enumeration difference); 5 failures lock the account 15 min; per-IP sliding-window limiter (429) | `auth.test.js` |
| Sessions | 256-bit random token, only its SHA-256 stored; new token on every login (no fixation); idle (30 min) and absolute (8 h) expiry enforced server-side; logout deletes the row; cookie HttpOnly + SameSite=Strict (+ Secure in production) | `auth.test.js` |
| CSRF | Fetch-Metadata and Origin checks, plus a per-session synchroniser token in `X-CSRF-Token` for authenticated writes | `auth.test.js` |
| Authorisation | One permission matrix (`src/lib/permissions.js`) enforced by `requirePermission` on every route; auditor has only `*:read` permissions; role is read from the session, never the request | `auth.test.js` (role × permission probe), `security.test.js` |
| Maker-checker | Service refuses self-decision (403, audited); database trigger also refuses it and requires a supervisor; partial unique indexes allow ≤1 pending and ≤1 approved proposal per break | `workflow.test.js` |
| Concurrency | Lock order break→proposal; version check; two simultaneous decisions → one 200, one 409; concurrent proposals, uploads and run creation each have exactly one winner | `workflow.test.js`, `sources.test.js`, `runs.test.js` |
| Input validation | zod schemas with `.strict()` (no mass assignment); ids and enums validated; amounts parsed from strings to integer paise; unknown sort keys never reach SQL (own-property whitelist) | `workflow.test.js`, `security.test.js` |
| SQL injection | Bind parameters everywhere; the only interpolated fragments are whitelisted `ORDER BY` expressions and integer `LIMIT/OFFSET` produced by zod | code review + sort whitelist test |
| File upload | Raw body size limit; `.csv` + `text/csv` only; strict UTF-8, NUL bytes rejected; row limit; header contract; file name reduced to a display string (never used as a path); bytes stored at `<sha256>.csv`, mode 0600, outside `public/` | `sources.test.js`, `security.test.js` |
| CSV injection | Identifiers must start alphanumeric; free text is stored as data and rendered with `textContent`; exports prefix cells starting with `= + - @ TAB CR` (and full-width forms) with `'` while leaving generated numeric cells untouched | `workflow.test.js`, `sources.test.js` |
| XSS | No `innerHTML` with data; CSP `default-src 'self'`, no inline script/style, `frame-ancestors 'none'`. The no-flash theme script is an external same-origin file (`/js/theme-init.js`) so no `unsafe-inline` or hash is needed | CSP header test; browser E2E and axe runs have zero console errors |
| Info leakage | Central handler: generic 500s, request id for correlation, no stack traces, SQL or paths; `X-Powered-By` removed; API responses `Cache-Control: no-store` | `auth.test.js` |
| Audit | Append-only triggers (UPDATE/DELETE/TRUNCATE rejected); business change and audit row share a transaction; failed logins, rejected uploads, blocked self-approvals are recorded; passwords/tokens are never logged (pino redaction as a backstop) | `workflow.test.js`, `auth.test.js` |
| Resource limits | 100 KB JSON bodies, `MAX_UPLOAD_BYTES`, `MAX_UPLOAD_ROWS`, `pageSize ≤ 100`, export ≤ 10,000 rows | `sources.test.js` |
| Demo tooling | Reset needs `NODE_ENV≠production`, `ALLOW_DEMO_RESET=true`, a `*_dev/_demo/_test` database name and `--yes` | `demo-reset-guards.test.js` |
| Dependencies | `npm audit` reported 0 vulnerabilities on 2026-11-08; 6 runtime dependencies | manual |

## Findings fixed during the review

* **Sort whitelist bypass:** `?sort=__proto__:asc` resolved to an inherited object and produced invalid SQL
  (a 500). Now an own-property check, with a regression test.
* **Unaudited upload rejections:** a bad file extension was rejected before the audit event was written. Now every
  rejected attempt is audited.
* **Self-deadlock risk:** recording the "self-decision blocked" audit row inside the decision transaction's
  scope would have waited on the row lock the same transaction held. It is now written after rollback.
* **Over-long file names** lost their extension when truncated and were rejected with a misleading error.

## Honest limitations

* **The audit log is append-only at the application and trigger level, not tamper-proof.** The database owner or
  a superuser can drop the triggers. A production deployment should run the app as a role that is not the table
  owner, ship audit rows to external write-once storage, and optionally hash-chain events. None of that is claimed here.
* The login limiter is in-memory (single process). Multiple instances need a shared store.
* No MFA, password-change/reset flow or user-management UI (users are created with `npm run user:create`).
* Uploaded files are validated structurally but not virus-scanned.
* Sessions are not revoked when a user is deactivated until their next request fails the `active` check
  (checked on every request, so effectively immediate) — but there is no "sign out everywhere" action.
* TLS is expected to terminate at a reverse proxy; set `TRUST_PROXY=true` and serve over HTTPS in production
  (`Secure` cookies and HSTS/upgrade-insecure-requests are enabled automatically when `NODE_ENV=production`).
* Demo accounts share a public password and exist only through `demo:reset`, which refuses to run in production.


## Added in v1.1.0

* **`GET /api/trace`** is read-only, needs `breaks:read` (every role), validates the reference (2–64 characters), upper-cases it and passes it as a bind parameter; a test sends SQL metacharacters. Rows are capped at 50 per side.
* **Overview activity feed** is built from `source_files`, runs and decisions, not from `audit_events`, so it does not widen who can read the audit log. Sign-in events are never in it.
* **Audit `hide=auth`** is an allow-listed enum; unknown values are a 400, so the filter cannot be used to smuggle SQL or silently hide other events.
* **Browser storage** holds only per-viewer conveniences: theme (`bj.theme`), row density (`bj.density`) in `localStorage`, and the break-queue ids for previous/next in `sessionStorage`. No tokens or personal data. All reads and writes are wrapped so blocked storage degrades silently.
* **Upload progress** uses `XMLHttpRequest` with the same cookie, CSRF header and content type as before; the server-side validation is unchanged and still authoritative (the client checks only the extension and emptiness as a convenience).
