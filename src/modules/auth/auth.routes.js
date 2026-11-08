'use strict';

const express = require('express');
const { z } = require('zod');
const auth = require('./auth.service');
const { COOKIE_NAME, cookieOptions, requireAuth } = require('../../middleware/auth');
const { rateLimiter } = require('../../middleware/rate-limit');
const { parseWith } = require('../../lib/validate');
const { permissionsFor } = require('../../lib/permissions');

const loginSchema = z.object({
  username: z.string().min(1).max(80),
  password: z.string().min(1).max(256),
}).strict();

function authRoutes(ctx) {
  const router = express.Router();
  const limiter = rateLimiter({ windowMs: ctx.config.loginRateWindowMs, max: ctx.config.loginRateMax });
  ctx.loginLimiter = limiter;

  router.post('/login', limiter, async (req, res) => {
    const body = parseWith(loginSchema, req.body);
    const result = await auth.login(ctx, req.actor, { ...body, userAgent: req.headers['user-agent'] });
    // Session id is regenerated on every login (a brand-new token), which defeats session fixation.
    res.cookie(COOKIE_NAME, result.token, { ...cookieOptions(ctx.config), maxAge: ctx.config.sessionAbsoluteHours * 3600 * 1000 });
    res.json({ data: { user: result.user, csrfToken: result.csrfToken, permissions: permissionsFor(result.user.role) } });
  });

  router.post('/logout', requireAuth, async (req, res) => {
    await auth.logout(ctx, req.actor, req.session);
    res.clearCookie(COOKIE_NAME, cookieOptions(ctx.config));
    res.status(204).end();
  });

  // Used by the page on load: answers 200 with null when signed out, so a logged-out visit is not an error.
  router.get('/session', (req, res) => {
    res.json({ data: req.user ? { user: req.user, csrfToken: req.session.csrfToken, permissions: permissionsFor(req.user.role) } : null });
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({ data: { user: req.user, csrfToken: req.session.csrfToken, permissions: permissionsFor(req.user.role) } });
  });

  return router;
}

module.exports = { authRoutes };
