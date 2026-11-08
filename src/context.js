'use strict';

const { createPool } = require('./db/pool');
const { createLogger } = require('./lib/logger');
const { createStorage } = require('./modules/sources/storage');

/** Wires config, database pool, logger and file storage into the context every module receives. */
function buildContext(config, { pool, logger } = {}) {
  const log = logger || createLogger(config.logLevel);
  return {
    config,
    logger: log,
    pool: pool || createPool(config.databaseUrl),
    storage: createStorage(config.uploadDir),
  };
}

module.exports = { buildContext };
