'use strict';

// Loads ./.env if present (Node's built-in loader; real environment variables always win).
try { process.loadEnvFile(); } catch (err) { if (err.code !== 'ENOENT') throw err; }
