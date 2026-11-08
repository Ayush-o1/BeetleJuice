'use strict';

const users = require('../users/user.repo');
const sessions = require('./session.repo');
const audit = require('../audit/audit.service');
const { hashPassword, verifyPassword } = require('./passwords');
const { unauthorized } = require('../../lib/errors');

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
// Verified against when the username does not exist, so "unknown user" costs the same time as "wrong password".
let dummyHashPromise;
const dummyHash = (log2N) => (dummyHashPromise ??= hashPassword('not-a-real-password', log2N));

const GENERIC_FAILURE = 'Invalid username or password, or the account is temporarily locked.';

async function login(ctx, actor, { username, password, userAgent }) {
  const { pool, config } = ctx;
  const name = username.trim().toLowerCase();
  const user = await users.findByUsername(pool, name);

  if (!user) {
    await verifyPassword(password, await dummyHash(config.scryptLog2N));
    await audit.record(pool, actor, { action: 'auth.login_failed', entityType: 'user', context: { attemptedUsername: name.slice(0, 40), reason: 'unknown_user' } });
    throw unauthorized(GENERIC_FAILURE);
  }

  const locked = user.lockedUntil && new Date(user.lockedUntil) > new Date();
  // Always run the hash comparison so locked and unlocked accounts look identical from outside.
  const passwordOk = await verifyPassword(password, user.passwordHash);

  if (!user.active || locked || !passwordOk) {
    const reason = !user.active ? 'inactive' : locked ? 'locked' : 'bad_password';
    if (reason === 'bad_password') {
      const after = await users.recordFailure(pool, user.id, { maxFailures: MAX_FAILURES, lockMinutes: LOCK_MINUTES });
      if (after.failedLoginCount === MAX_FAILURES) {
        await audit.record(pool, { ...actor, user }, { action: 'auth.account_locked', entityType: 'user', entityId: user.id, context: { lockMinutes: LOCK_MINUTES } });
      }
    }
    await audit.record(pool, { ...actor, user }, { action: 'auth.login_failed', entityType: 'user', entityId: user.id, context: { reason } });
    throw unauthorized(GENERIC_FAILURE);
  }

  await users.recordSuccess(pool, user.id);
  const { token, csrfToken } = await sessions.create(pool, {
    userId: user.id, ip: actor.ip, userAgent, absoluteHours: config.sessionAbsoluteHours,
  });
  await audit.record(pool, { ...actor, user }, { action: 'auth.login', entityType: 'user', entityId: user.id });
  return { token, csrfToken, user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role } };
}

async function logout(ctx, actor, session) {
  await sessions.destroy(ctx.pool, session.sessionId);
  await audit.record(ctx.pool, actor, { action: 'auth.logout', entityType: 'user', entityId: actor.user.id });
}

module.exports = { login, logout, GENERIC_FAILURE };
