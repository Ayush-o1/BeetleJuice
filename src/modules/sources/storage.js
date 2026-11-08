'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * Raw uploaded bytes live on disk, outside public/, named by their SHA-256 (content-addressed).
 * The same bytes always map to the same file, so writing twice is harmless and there is no
 * user-controlled path component. Files are 0600 inside a 0700 directory. PostgreSQL keeps the
 * metadata, the hash and the parsed rows; the file is the evidence of what was actually received.
 */
function createStorage(uploadDir) {
  const pathFor = (sha256) => path.join(uploadDir, `${sha256}.csv`);
  return {
    pathFor,
    async save(sha256, buffer) {
      await fs.mkdir(uploadDir, { recursive: true, mode: 0o700 });
      try {
        await fs.writeFile(pathFor(sha256), buffer, { flag: 'wx', mode: 0o600 });
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
      }
    },
    async read(sha256) {
      return fs.readFile(pathFor(sha256));
    },
  };
}

module.exports = { createStorage };
