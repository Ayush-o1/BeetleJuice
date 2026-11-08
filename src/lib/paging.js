'use strict';

const { z } = require('zod');

const pagingSchema = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};

/** Standard list envelope: { data: [...], page: { number, size, total, pages } }. */
function pageResponse(rows, total, page, pageSize) {
  return { data: rows, page: { number: page, size: pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) } };
}

/**
 * Turns "?sort=impact:desc" into a safe ORDER BY clause. Only keys present in `allowed`
 * (mapping to SQL expressions we wrote) can ever reach the query text.
 */
function orderBy(sortParam, allowed, fallback, tiebreak) {
  const [key, dirRaw] = String(sortParam || '').split(':');
  const expr = allowed[key];
  if (!expr) return `${fallback}, ${tiebreak}`;
  const dir = dirRaw === 'asc' ? 'ASC' : 'DESC';
  return `${expr} ${dir}, ${tiebreak}`;
}

module.exports = { pagingSchema, pageResponse, orderBy };
