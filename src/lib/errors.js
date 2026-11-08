'use strict';

/**
 * Expected domain/HTTP failures. Anything that is NOT an AppError is treated as an
 * unexpected technical failure by the error handler: logged in full, reported to the
 * client as a generic 500 with no internals.
 */
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (message, details) => new AppError(400, 'BAD_REQUEST', message, details);
const validationFailed = (message, details) => new AppError(400, 'VALIDATION_FAILED', message, details);
const unauthorized = (message = 'Authentication required') => new AppError(401, 'UNAUTHENTICATED', message);
const forbidden = (message = 'You do not have permission to perform this action') =>
  new AppError(403, 'FORBIDDEN', message);
const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
const conflict = (code, message, details) => new AppError(409, code, message, details);
const unprocessable = (code, message, details) => new AppError(422, code, message, details);
const tooMany = (message = 'Too many attempts. Try again later.') => new AppError(429, 'RATE_LIMITED', message);

module.exports = {
  AppError, badRequest, validationFailed, unauthorized, forbidden, notFound, conflict, unprocessable, tooMany,
};
