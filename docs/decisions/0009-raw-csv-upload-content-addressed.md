# 0009 — Raw CSV request bodies and content-addressed storage

**Status:** accepted. **Source consulted:** OWASP CSV Injection page (dangerous leading characters; mitigation).

**Decision.** Uploads are `POST` bodies with `Content-Type: text/csv` and the name in `X-Filename`, so no multipart
parser is needed (one fewer dependency and attack surface; trivial in Postman/curl). Bytes are written to
`UPLOAD_DIR/<sha256>.csv` (0600, outside `public/`), so there is no user-controlled path. Duplicate files are decided
by a unique `(kind, sha256)` index (`INSERT … ON CONFLICT DO NOTHING`), which is race-free. Valid rows load and invalid
rows are stored with their reasons; a file with no valid rows, or with a bad header, is rejected whole. Identifiers
must start alphanumeric; text is stored verbatim and neutralised on export.

**Alternatives.** `multer`/busboy multipart: more code for a single file field. Storing bytes in PostgreSQL: simple,
but bloats the database; the hash links the file to the metadata. Rejecting any file with a bad row: forces re-export
of 50,000 rows for one typo; the brief asks for explicit row-level reporting instead.
