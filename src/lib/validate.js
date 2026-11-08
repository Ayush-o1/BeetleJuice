'use strict';

const { z } = require('zod');
const { validationFailed } = require('./errors');

/** Parses `data` with a zod schema; on failure throws a 400 listing every offending field. */
function parseWith(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ path: i.path.join('.') || '(body)', message: i.message }));
    throw validationFailed('Request validation failed', { issues });
  }
  return result.data;
}

/** Route parameter such as :id — a positive integer that fits a JS safe integer. */
const idSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const parseId = (value) => parseWith(idSchema, value);

module.exports = { parseWith, parseId, idSchema };
