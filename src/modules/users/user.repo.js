'use strict';

const COLS = 'id, username, display_name AS "displayName", role, password_hash AS "passwordHash", active, failed_login_count AS "failedLoginCount", locked_until AS "lockedUntil"';

async function findByUsername(db, username) {
  const { rows } = await db.query(`SELECT ${COLS} FROM users WHERE username = $1`, [username]);
  return rows[0] || null;
}

async function findById(db, id) {
  const { rows } = await db.query(`SELECT ${COLS} FROM users WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function create(db, { username, displayName, role, passwordHash }) {
  const { rows } = await db.query(
    `INSERT INTO users (username, display_name, role, password_hash) VALUES ($1,$2,$3,$4)
     RETURNING id, username, display_name AS "displayName", role`,
    [username, displayName, role, passwordHash],
  );
  return rows[0];
}

/** Atomic increment so concurrent failed attempts cannot undercount; locks at the threshold. */
async function recordFailure(db, id, { maxFailures, lockMinutes }) {
  const { rows } = await db.query(
    `UPDATE users
        SET failed_login_count = failed_login_count + 1,
            locked_until = CASE WHEN failed_login_count + 1 >= $2
                                THEN now() + make_interval(mins => $3) ELSE locked_until END
      WHERE id = $1
      RETURNING failed_login_count AS "failedLoginCount", locked_until AS "lockedUntil"`,
    [id, maxFailures, lockMinutes],
  );
  return rows[0];
}

async function recordSuccess(db, id) {
  await db.query('UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [id]);
}

module.exports = { findByUsername, findById, create, recordFailure, recordSuccess };
