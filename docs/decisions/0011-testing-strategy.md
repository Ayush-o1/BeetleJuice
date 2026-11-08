# 0011 — Testing with `node:test`, real PostgreSQL and a real browser

**Status:** accepted.

**Decision.** Node's built-in runner, `fetch` against an ephemeral server, and a real PostgreSQL database that is
migrated by the production migrations (no mocks for the data layer). Browser E2E uses `playwright-core` against the
installed Chrome so nothing is downloaded. Supertest and Jest were not added: the built-ins cover the need.

**Consequences.** Tests catch real constraint, locking and race behaviour (several bugs in this project were found
that way). The suite needs PostgreSQL and, for the browser tests, Chrome; without Chrome the browser tests skip and say why.
