'use strict';

const pino = require('pino');

/**
 * Structured JSON logger. Redaction is a second line of defence: handlers should never
 * pass secrets in the first place, but if a request body or header ends up in a log
 * object these paths are masked.
 */
function createLogger(level = 'info') {
  return pino({
    level,
    redact: {
      paths: [
        'req.headers.cookie', 'req.headers.authorization', 'headers.cookie', 'headers["x-csrf-token"]',
        '*.password', '*.password_hash', '*.passwordHash', '*.csrfToken', '*.token',
      ],
      censor: '[redacted]',
    },
  });
}

module.exports = { createLogger };
