'use strict';

const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { requestContext } = require('./middleware/request-context');
const { loadSession, csrfProtection } = require('./middleware/auth');
const { notFoundHandler, errorHandler } = require('./middleware/error-handler');
const { authRoutes } = require('./modules/auth/auth.routes');
const { sourceRoutes } = require('./modules/sources/source.routes');
const { settingsRoutes } = require('./modules/settings/settings.routes');
const { runRoutes } = require('./modules/runs/run.routes');
const { breakRoutes } = require('./modules/breaks/break.routes');
const { resolutionRoutes } = require('./modules/resolutions/resolution.routes');
const { auditRoutes } = require('./modules/audit/audit.routes');
const { overviewRoutes } = require('./modules/overview/overview.routes');
const { traceRoutes } = require('./modules/trace/trace.routes');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

/**
 * Builds the Express app from an explicit context { config, pool, logger, storage }.
 * Nothing here reads process.env or opens connections, which keeps tests hermetic.
 */
function createApp(ctx) {
  const { config, pool, logger } = ctx;
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(requestContext(logger));
  app.use(helmet({
    // No inline script or style anywhere in the UI, so the policy can be strict.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"], connectSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"],
        formAction: ["'self'"], frameAncestors: ["'none'"],
        // Only force https when we are actually served over it; plain-http dev/LAN use must keep working.
        upgradeInsecureRequests: config.cookieSecure ? [] : null,
      },
    },
    strictTransportSecurity: config.cookieSecure ? undefined : false,
    referrerPolicy: { policy: 'same-origin' },
  }));

  // API responses carry account and financial data: never cache them.
  app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  app.get('/api/health', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'degraded' });
    }
  });

  app.use('/api', express.json({ limit: '100kb' }), loadSession(ctx), csrfProtection);
  app.use('/api/auth', authRoutes(ctx));
  app.use('/api/overview', overviewRoutes(ctx));
  app.use('/api/sources', sourceRoutes(ctx));
  app.use('/api/settings', settingsRoutes(ctx));
  app.use('/api/runs', runRoutes(ctx));
  app.use('/api/breaks', breakRoutes(ctx));
  app.use('/api/proposals', resolutionRoutes(ctx));
  app.use('/api/audit', auditRoutes(ctx));
  app.use('/api/trace', traceRoutes(ctx));
  app.use('/api', notFoundHandler);

  app.use(express.static(PUBLIC_DIR, {
    index: 'index.html',
    setHeaders(res, file) {
      // Fonts are versioned by filename; app code is revalidated on every load (ETag keeps it cheap).
      res.setHeader('Cache-Control', file.includes(`${path.sep}fonts${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  }));
  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}

module.exports = { createApp };
