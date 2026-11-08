'use strict';

const { AppError } = require('../lib/errors');

/** pg error codes that mean "the data violated a rule we enforce in the database". */
const PG_CONFLICT = {
  '23505': ['CONFLICT_DUPLICATE', 'A record with the same unique value already exists'],
  '23001': ['CONFLICT_RESTRICTED', 'The operation is not permitted by data integrity rules'],
  '23503': ['CONFLICT_REFERENCE', 'The record is referenced by, or refers to, data that does not exist or cannot change'],
};

function notFoundHandler(req, res, next) {
  next(new AppError(404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`));
}

/**
 * One place that turns exceptions into the standard error body:
 *   { error: { code, message, details?, requestId } }
 * Expected failures (AppError, body-parser errors) keep their status and message; anything else
 * is logged in full and answered with a generic 500 — no stack traces, SQL or paths reach clients.
 */
function errorHandler(logger) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';
    let details;

    if (err instanceof AppError) {
      ({ status, code, message, details } = err);
    } else if (err?.type === 'entity.too.large') {
      status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'The request body is too large';
    } else if (err?.type === 'entity.parse.failed') {
      status = 400; code = 'BAD_JSON'; message = 'The request body is not valid JSON';
    } else if (err?.type === 'encoding.unsupported' || err?.type === 'charset.unsupported') {
      status = 415; code = 'UNSUPPORTED_ENCODING'; message = 'Unsupported content encoding';
    } else if (err?.code && PG_CONFLICT[err.code]) {
      [code, message] = PG_CONFLICT[err.code];
      status = 409;
      logger.warn({ requestId: req.id, pgCode: err.code, constraint: err.constraint }, 'database rule rejected a write');
    } else {
      logger.error({ requestId: req.id, err: { message: err?.message, stack: err?.stack, code: err?.code } }, 'unhandled error');
    }
    if (res.headersSent) return;
    res.status(status).json({ error: { code, message, ...(details ? { details } : {}), requestId: req.id } });
  };
}

module.exports = { notFoundHandler, errorHandler };
