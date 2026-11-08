'use strict';

// Usage: BJ_PASSWORD='...' npm run user:create -- <username> <role> "<Display Name>"
// The password is read from the environment so it never appears in shell history or process lists.
require('../src/load-env');
const { loadConfig } = require('../src/config');
const { createPool } = require('../src/db/pool');
const users = require('../src/modules/users/user.repo');
const { hashPassword, checkPasswordPolicy } = require('../src/modules/auth/passwords');

(async () => {
  const [username, role, ...nameParts] = process.argv.slice(2);
  const displayName = nameParts.join(' ').trim();
  const password = process.env.BJ_PASSWORD;
  if (!username || !role || !displayName || !password) {
    throw new Error('Usage: BJ_PASSWORD=... npm run user:create -- <username> <analyst|supervisor|auditor> "<Display Name>"');
  }
  const problem = checkPasswordPolicy(password);
  if (problem) throw new Error(problem);
  const config = loadConfig();
  const pool = createPool(config.databaseUrl, { max: 1 });
  try {
    const u = await users.create(pool, { username: username.toLowerCase(), displayName, role, passwordHash: await hashPassword(password, config.scryptLog2N) });
    console.log(`Created ${u.role} "${u.username}" (id ${u.id}).`);
  } finally {
    await pool.end();
  }
})().catch((err) => { console.error(err.code === '23505' ? 'That username already exists.' : err.message); process.exit(1); });
