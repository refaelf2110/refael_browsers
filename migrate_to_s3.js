'use strict';

/**
 * migrate_to_s3.js
 *
 * Reads all tables from the local SQLite results database and uploads them
 * to s3://refael-results/<table>/<table>.parquet
 *
 * Usage:
 *   node migrate_to_s3.js
 *
 * Prerequisites:
 *   npm install @dsnp/parquetjs @aws-sdk/client-s3
 *
 * AWS credentials are read from the "terraform" profile (~/.aws/credentials).
 */

const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const Database = require('better-sqlite3');
const parquet  = require('@dsnp/parquetjs');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { fromIni } = require('@aws-sdk/credential-providers');

// ── Config ─────────────────────────────────────────────────────────────────────

const DB_PATH     = path.join(__dirname, 'browser-cache', 'results.db');
const S3_BUCKET   = 'refael-results';
const AWS_REGION  = 'us-east-1';
const AWS_PROFILE = 'terraform';

const s3 = new S3Client({
  region: AWS_REGION,
  credentials: fromIni({ profile: AWS_PROFILE }),
});

// ── Parquet schemas (must match athena.tf Glue table definitions) ─────────────

const SCHEMAS = {
  runs: new parquet.ParquetSchema({
    id:           { type: 'UTF8' },
    run_type:     { type: 'UTF8' },
    completed_at: { type: 'UTF8' },
    elapsed:      { type: 'UTF8' },
  }),

  results: new parquet.ParquetSchema({
    id:          { type: 'UTF8' },
    run_id:      { type: 'UTF8' },
    framework:   { type: 'UTF8' },
    label:       { type: 'UTF8' },
    major:       { type: 'UTF8' },
    mode:        { type: 'UTF8' },
    all_reasons: { type: 'UTF8' },
    error:       { type: 'UTF8', optional: true },
  }),

  window_elements: new parquet.ParquetSchema({
    id:            { type: 'UTF8' },
    browser_label: { type: 'UTF8' },
    collected_at:  { type: 'UTF8' },
    name:          { type: 'UTF8', optional: true },
    type:          { type: 'UTF8', optional: true },
    value:         { type: 'UTF8', optional: true },
    raw:           { type: 'UTF8' },
  }),

  interception_sessions: new parquet.ParquetSchema({
    id:            { type: 'UTF8' },
    framework:     { type: 'UTF8' },
    browser_label: { type: 'UTF8' },
    started_at:    { type: 'UTF8' },
    completed_at:  { type: 'UTF8', optional: true },
    action_count:  { type: 'INT32' },
    call_count:    { type: 'INT32' },
  }),

  interceptions: new parquet.ParquetSchema({
    id:             { type: 'UTF8' },
    session_id:     { type: 'UTF8' },
    seq:            { type: 'INT32' },
    action:         { type: 'UTF8' },
    fn_name:        { type: 'UTF8' },
    args_json:      { type: 'UTF8', optional: true },
    this_arg:       { type: 'UTF8', optional: true },
    caller:         { type: 'UTF8', optional: true },
    return_val:     { type: 'UTF8', optional: true },
    is_constructor: { type: 'BOOLEAN' },
    duration_ms:    { type: 'DOUBLE' },
    stack:          { type: 'UTF8', optional: true },
    triggered_at:   { type: 'UTF8' },
  }),
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Coerce a SQLite row to match the Parquet schema — all values to correct types. */
function coerceRow(table, row) {
  const out = {};
  for (const [col, def] of Object.entries(SCHEMAS[table].schema)) {
    let val = row[col];

    // Nulls on optional fields are fine; nulls on required fields become defaults
    if (val === null || val === undefined) {
      if (def.optional) { out[col] = null; continue; }
      // required fallback
      if (def.type === 'UTF8')    { out[col] = ''; continue; }
      if (def.type === 'INT32')   { out[col] = 0;  continue; }
      if (def.type === 'DOUBLE')  { out[col] = 0;  continue; }
      if (def.type === 'BOOLEAN') { out[col] = false; continue; }
    }

    if (def.type === 'UTF8')    out[col] = String(val);
    else if (def.type === 'INT32')   out[col] = Number(val) | 0;
    else if (def.type === 'DOUBLE')  out[col] = Number(val) || 0;
    else if (def.type === 'BOOLEAN') out[col] = val === 1 || val === true;
    else out[col] = val;
  }
  return out;
}

async function migrateTable(db, tableName) {
  console.log(`\n── ${tableName} ────────────────────────`);

  // Check if table exists
  const exists = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
  ).get(tableName);

  if (!exists) {
    console.log(`  Table not found in SQLite — skipping`);
    return;
  }

  const rows = db.prepare(`SELECT * FROM ${tableName}`).all();
  console.log(`  ${rows.length} rows read from SQLite`);

  if (rows.length === 0) {
    console.log(`  Empty table — skipping upload`);
    return;
  }

  // Write Parquet to a temp file
  const tmpFile = path.join(os.tmpdir(), `${tableName}.parquet`);
  const writer  = await parquet.ParquetWriter.openFile(SCHEMAS[tableName], tmpFile);
  for (const row of rows) {
    await writer.appendRow(coerceRow(tableName, row));
  }
  await writer.close();

  const fileSize = fs.statSync(tmpFile).size;
  console.log(`  Parquet written: ${tmpFile} (${(fileSize / 1024).toFixed(1)} KB)`);

  // Upload to S3
  const s3Key = `${tableName}/${tableName}.parquet`;
  await s3.send(new PutObjectCommand({
    Bucket:      S3_BUCKET,
    Key:         s3Key,
    Body:        fs.readFileSync(tmpFile),
    ContentType: 'application/octet-stream',
  }));

  fs.unlinkSync(tmpFile);
  console.log(`  Uploaded to s3://${S3_BUCKET}/${s3Key}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Opening database: ${DB_PATH}`);
  const db = new Database(DB_PATH, { readonly: true });

  for (const tableName of Object.keys(SCHEMAS)) {
    await migrateTable(db, tableName);
  }

  db.close();
  console.log('\nMigration complete.');
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
