# 0001 — One Express monolith, plain SQL, a small migration runner

**Status:** accepted

**Context.** The product is one workflow over one relational dataset with strong integrity needs. The author's
stack is Node/Express/PostgreSQL.

**Decision.** A single Express process with feature modules (route → service → repository). SQL is written
directly with `pg` and bind parameters. Migrations are ordered `.sql` files applied by a ~60-line runner
(`src/db/migrate.js`) with an advisory lock and a checksum per applied file.

**Alternatives.** An ORM (Prisma/Sequelize): hides the constraints, locks and `SKIP LOCKED` queries this project is
meant to demonstrate and adds a generation step. A query builder (Knex/Kysely): useful, but most queries are
fixed and readable as SQL; dynamic filters are the only part and are small and whitelisted. `node-pg-migrate`:
fine, but the custom runner is small enough to read and teach, and has no extra dependency. Microservices/queues:
no benefit at this size.

**Consequences.** SQL is explicit and reviewable; invariants live in the schema. The cost is hand-written
mapping (`AS "camelCase"`) and a migration runner without down-migrations (forward-only by policy).
