'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const KEYLEN = 64;
const R = 8;
const P = 1;

/**
 * scrypt password hashing from Node's own crypto module (no native add-on to install).
 * OWASP's Password Storage Cheat Sheet ranks Argon2id first and scrypt second, with minimum
 * parameters N=2^17, r=8, p=1; those are the production defaults here. The cost is stored in
 * each hash, so it can be raised later and old hashes still verify.
 * Format: scrypt$<log2N>$<r>$<p>$<salt b64>$<hash b64>
 */
async function hashPassword(password, log2N = 17) {
  const salt = crypto.randomBytes(16);
  const N = 2 ** log2N;
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 256 * N * R });
  return ['scrypt', log2N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, log2N, r, p, saltB64, hashB64] = parts;
  const N = 2 ** Number(log2N);
  const expected = Buffer.from(hashB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N, r: Number(r), p: Number(p), maxmem: 256 * N * Number(r),
  });
  return crypto.timingSafeEqual(key, expected);
}

/** Minimum policy for passwords set through the CLI. Length matters more than composition. */
function checkPasswordPolicy(password) {
  if (typeof password !== 'string' || password.length < 12) return 'Password must be at least 12 characters';
  if (password.length > 128) return 'Password must be at most 128 characters';
  return null;
}

module.exports = { hashPassword, verifyPassword, checkPasswordPolicy };
