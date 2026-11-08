'use strict';

const crypto = require('node:crypto');

const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex');

/** Stable JSON: object keys sorted recursively, so equal configs always hash equally. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

module.exports = { sha256Hex, canonicalJson };
