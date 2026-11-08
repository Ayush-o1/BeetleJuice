'use strict';

const path = require('node:path');
const { z } = require('zod');

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const int = (min, max) => z.coerce.number().int().min(min).max(max);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: int(1, 65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required').refine((v) => /^postgres(ql)?:\/\//.test(v), {
    message: 'DATABASE_URL must be a postgres:// connection string',
  }),
  UPLOAD_DIR: z.string().default('./data/uploads'),
  MAX_UPLOAD_BYTES: int(1024, 100 * 1024 * 1024).default(10 * 1024 * 1024),
  MAX_UPLOAD_ROWS: int(1, 500000).default(50000),
  SESSION_IDLE_MINUTES: int(1, 24 * 60).default(30),
  SESSION_ABSOLUTE_HOURS: int(1, 72).default(8),
  COOKIE_SECURE: bool.optional(),
  TRUST_PROXY: bool.default('false'),
  WORKER_IN_PROCESS: bool.default('true'),
  WORKER_POLL_MS: int(50, 60000).default(1500),
  RUN_MAX_ATTEMPTS: int(1, 10).default(3),
  RUN_LEASE_SECONDS: int(5, 3600).default(120),
  // scrypt cost. OWASP minimum is N=2^17; lowering is only honoured outside production.
  SCRYPT_LOG2_N: int(10, 20).default(17),
  LOGIN_RATE_MAX: int(1, 100000).default(20),
  LOGIN_RATE_WINDOW_MINUTES: int(1, 1440).default(15),
});

/**
 * Validates the environment once at startup and returns a frozen config object.
 * Throws a single readable error listing every problem rather than failing on the first.
 */
function loadConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  if (e.NODE_ENV === 'production' && e.SCRYPT_LOG2_N < 17) {
    throw new Error('Invalid configuration:\n  - SCRYPT_LOG2_N: must be at least 17 in production');
  }
  return Object.freeze({
    env: e.NODE_ENV,
    isProduction: e.NODE_ENV === 'production',
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    uploadDir: path.resolve(e.UPLOAD_DIR),
    maxUploadBytes: e.MAX_UPLOAD_BYTES,
    maxUploadRows: e.MAX_UPLOAD_ROWS,
    sessionIdleMinutes: e.SESSION_IDLE_MINUTES,
    sessionAbsoluteHours: e.SESSION_ABSOLUTE_HOURS,
    cookieSecure: e.COOKIE_SECURE ?? e.NODE_ENV === 'production',
    trustProxy: e.TRUST_PROXY,
    workerInProcess: e.WORKER_IN_PROCESS,
    workerPollMs: e.WORKER_POLL_MS,
    runMaxAttempts: e.RUN_MAX_ATTEMPTS,
    runLeaseSeconds: e.RUN_LEASE_SECONDS,
    scryptLog2N: e.SCRYPT_LOG2_N,
    loginRateMax: e.LOGIN_RATE_MAX,
    loginRateWindowMs: e.LOGIN_RATE_WINDOW_MINUTES * 60000,
  });
}

module.exports = { loadConfig };
