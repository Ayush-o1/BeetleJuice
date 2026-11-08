# 0002 — Server-side sessions in PostgreSQL with a CSRF token, not JWT

**Status:** accepted. **Sources consulted:** OWASP Session Management and CSRF Prevention cheat sheets.

**Context.** Same-origin browser app; sessions must be revocable and short-lived; roles must be authoritative
server-side.

**Decision.** Opaque 256-bit session token in an HttpOnly, SameSite=Strict (Secure in production) cookie; only its
SHA-256 is stored in `sessions`, with an idle timeout (30 min, sliding, written at most once a minute) and an
absolute lifetime (8 h). A new token on each login. CSRF: Fetch-Metadata/Origin checks plus a per-session
synchroniser token sent in `X-CSRF-Token`. No `localStorage` for tokens.

**Alternatives.** JWT: needs a revocation list to reach parity, and storing it in `localStorage` exposes it to XSS;
unnecessary for a single-origin app. `express-session` + store: two dependencies for ~80 lines we can read and test.
Double-submit cookie: OWASP discourages the naive form.

**Consequences.** One indexed lookup per request. Role changes and deactivation take effect immediately.
The custom code is small but security-sensitive, so it has dedicated tests (fixation, expiry, CSRF, logout replay).
