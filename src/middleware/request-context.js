'use strict';

const crypto = require('node:crypto');

/** Assigns a request id (echoed in responses, logs and audit rows) and an access log line. */
function requestContext(logger) {
  return (req, res, next) => {
    req.id = crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    req.actor = { user: null, ip: req.ip, requestId: req.id };
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      logger.info({
        requestId: req.id, method: req.method, path: req.path, status: res.statusCode,
        ms: Number((process.hrtime.bigint() - started) / 1_000_000n), userId: req.actor.user?.id,
      }, 'request');
    });
    next();
  };
}

module.exports = { requestContext };
