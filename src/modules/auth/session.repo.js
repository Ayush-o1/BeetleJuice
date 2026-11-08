'use strict';

const crypto = require('node:crypto');
const { sha256Hex } = require('../../lib/hash');

/**
 * Server-side sessions. The browser holds a 256-bit random token; the database holds only its
 * SHA-256, so reading the sessions table does not give an attacker usable cookies.
 * Two clocks apply: an idle timeout (slides with activity) and an absolute lifetime (never extended).
 */
async function create(db, { userId, ip, userAgent, absoluteHours }) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrfToken = crypto.randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO sessions (id, user_id, csrf_token, expires_at, ip, user_agent)
     VALUES ($1,$2,$3, now() + make_interval(hours => $4), $5, $6)`,
    [sha256Hex(token), userId, csrfToken, absoluteHours, ip, (userAgent || '').slice(0, 300)],
  );
  return { token, csrfToken };
}

/** Returns the live session + user, or null when missing, expired or idle too long. */
async function find(db, token, { idleMinutes }) {
  const { rows } = await db.query(
    `SELECT s.id AS "sessionId", s.csrf_token AS "csrfToken", s.last_seen_at AS "lastSeenAt",
            u.id, u.username, u.display_name AS "displayName", u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND u.active
        AND s.expires_at > now()
        AND s.last_seen_at > now() - make_interval(mins => $2)`,
    [sha256Hex(token), idleMinutes],
  );
  return rows[0] || null;
}

/** Slide the idle window, but write at most once a minute per session to avoid a write per request. */
async function touch(db, sessionId) {
  await db.query(
    "UPDATE sessions SET last_seen_at = now() WHERE id = $1 AND last_seen_at < now() - interval '1 minute'",
    [sessionId],
  );
}

async function destroy(db, sessionId) {
  await db.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}

async function purgeExpired(db) {
  await db.query('DELETE FROM sessions WHERE expires_at <= now()');
}

module.exports = { create, find, touch, destroy, purgeExpired };
