-- 0001: shared helpers, users and server-side sessions.

-- Reused by every table that must never change after insert. The check is a
-- database-level backstop: even a buggy service or a stray psql session as the
-- application role cannot rewrite history without first dropping the trigger.
CREATE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% on % is not permitted: records are append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TABLE users (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username           text        NOT NULL CHECK (username ~ '^[a-z0-9._-]{3,40}$'),
  display_name       text        NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  role               text        NOT NULL CHECK (role IN ('analyst', 'supervisor', 'auditor')),
  password_hash      text        NOT NULL,
  active             boolean     NOT NULL DEFAULT true,
  failed_login_count integer     NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until       timestamptz,
  last_login_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username_key ON users (username);

-- The cookie carries a random token; only its SHA-256 is stored, so a leaked
-- table (backup, SQL injection read) does not yield usable session cookies.
CREATE TABLE sessions (
  id           char(64)    PRIMARY KEY CHECK (id ~ '^[0-9a-f]{64}$'),
  user_id      bigint      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  csrf_token   text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,       -- absolute lifetime, never extended
  ip           text,
  user_agent   text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);
