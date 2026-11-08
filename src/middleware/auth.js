'use strict';

const crypto = require('node:crypto');
const sessions = require('../modules/auth/session.repo');
const { can } = require('../lib/permissions');
const { unauthorized, forbidden } = require('../lib/errors');

const COOKIE_NAME = 'bj_session';

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function cookieOptions(config) {
  // SameSite=Strict: the app is same-origin only. HttpOnly keeps the token away from page scripts.
  return { httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, path: '/' };
}

/** Resolves the session cookie into req.user / req.session (if valid). Never rejects by itself. */
function loadSession(ctx) {
  return async (req, res, next) => {
    const token = readCookie(req, COOKIE_NAME);
    if (token) {
      const found = await sessions.find(ctx.pool, token, { idleMinutes: ctx.config.sessionIdleMinutes });
      if (found) {
        await sessions.touch(ctx.pool, found.sessionId);
        req.session = found;
        req.user = { id: found.id, username: found.username, displayName: found.displayName, role: found.role };
        req.actor.user = req.user;
      } else {
        res.clearCookie(COOKIE_NAME, cookieOptions(ctx.config));
      }
    }
    next();
  };
}

const requireAuth = (req, res, next) => (req.user ? next() : next(unauthorized()));

/** Authorization is decided here, on the server, from the session's role — never from the request body. */
const requirePermission = (permission) => (req, res, next) => {
  if (!req.user) return next(unauthorized());
  return can(req.user.role, permission) ? next() : next(forbidden());
};

/**
 * CSRF defence for cookie sessions, layered as OWASP recommends:
 *  1. Fetch-Metadata / Origin must indicate same-origin whenever the browser sends them.
 *  2. Authenticated state-changing requests must carry the per-session synchroniser token
 *     in X-CSRF-Token (a custom header cross-site pages cannot set without CORS approval).
 *  3. The session cookie is SameSite=Strict (defence in depth, not the primary control).
 */
function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const site = req.headers['sec-fetch-site'];
  if (site && !['same-origin', 'none'].includes(site)) return next(forbidden('Cross-site request blocked'));
  const origin = req.headers.origin;
  if (origin) {
    let host;
    try { host = new URL(origin).host; } catch { host = null; }
    if (host !== req.headers.host) return next(forbidden('Cross-origin request blocked'));
  }
  if (req.session) {
    const sent = Buffer.from(String(req.headers['x-csrf-token'] || ''));
    const expected = Buffer.from(req.session.csrfToken);
    if (sent.length !== expected.length || !crypto.timingSafeEqual(sent, expected)) {
      return next(forbidden('Missing or invalid CSRF token'));
    }
  }
  return next();
}

module.exports = { COOKIE_NAME, cookieOptions, loadSession, requireAuth, requirePermission, csrfProtection };
