'use strict';

const { tooMany } = require('../lib/errors');

/**
 * Small in-memory sliding-window limiter, keyed by client IP. Adequate for a single-process
 * deployment; a multi-instance deployment would need a shared store (documented limitation).
 */
function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, v] of hits) {
      const kept = v.filter((t) => t > cutoff);
      if (kept.length) hits.set(k, kept); else hits.delete(k);
    }
  }, Math.min(windowMs, 60000));
  timer.unref();

  const middleware = (req, res, next) => {
    const now = Date.now();
    const recent = (hits.get(req.ip) || []).filter((t) => t > now - windowMs);
    if (recent.length >= max) {
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
      return next(tooMany('Too many sign-in attempts from this address. Try again later.'));
    }
    recent.push(now);
    hits.set(req.ip, recent);
    return next();
  };
  middleware.reset = () => hits.clear();
  return middleware;
}

module.exports = { rateLimiter };
