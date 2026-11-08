# 0003 — scrypt from `node:crypto` for passwords

**Status:** accepted. **Source consulted:** OWASP Password Storage cheat sheet (Argon2id first; scrypt acceptable
with N=2¹⁷, r=8, p=1).

**Decision.** `crypto.scrypt` with the OWASP minimum cost, random 16-byte salt, parameters embedded in the stored
string (`scrypt$17$8$1$salt$hash`) so cost can be raised later. Production refuses `SCRYPT_LOG2_N < 17`; tests use 2¹⁰.

**Alternatives.** Argon2id is preferred by OWASP but needs a native add-on (build/prebuilt-binary risk) for a
marginal gain at this scale. bcrypt: legacy choice with a 72-byte limit.

**Consequences.** No native dependency. Each login allocates ~128 MiB briefly; the login rate limiter bounds this.
Rehash-on-login is not implemented because there is only one cost today.
