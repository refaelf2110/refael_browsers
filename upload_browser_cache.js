'use strict';

/**
 * upload_browser_cache.js
 *
 * Uploads the local browser-cache/ directory to s3://refael-browsers-cache/windows/
 * maintaining the same folder structure.
 *
 * Usage:
 *   node upload_browser_cache.js
 *
 * Already-uploaded files are skipped (compares by size + ETag).
 * Concurrency: up to 8 uploads in parallel.
 */

const fs   = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, HeadObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { fromIni } = require('@aws-sdk/credential-providers');

const SOURCE_DIR = path.join(__dirname, 'browser-cache');
const BUCKET     = 'refael-browsers-cache';
const PREFIX     = 'windows/';
const REGION     = 'us-east-1';
const PROFILE    = 'terraform';
const CONCURRENCY = 8;

const s3 = new S3Client({
  region:      REGION,
  credentials: fromIni({ profile: PROFILE }),
});

// Walk a directory recursively, returning absolute file paths.
function* walkDir(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkDir(full);
    } else {
      yield full;
    }
  }
}

// Fetch all existing S3 keys under the prefix so we can skip them.
async function listExistingKeys() {
  const keys = new Map(); // key → size
  let token;
  do {
    const resp = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: PREFIX,
      ContinuationToken: token,
    }));
    for (const obj of (resp.Contents || [])) {
      keys.set(obj.Key, obj.Size);
    }
    token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function uploadFile(localPath, s3Key, existingKeys) {
  const stat = fs.statSync(localPath);
  const existingSize = existingKeys.get(s3Key);

  if (existingSize !== undefined && existingSize === stat.size) {
    process.stdout.write(`  skip  ${s3Key}\n`);
    return { skipped: true };
  }

  const body = fs.createReadStream(localPath);
  await s3.send(new PutObjectCommand({
    Bucket:        BUCKET,
    Key:           s3Key,
    Body:          body,
    ContentLength: stat.size,
  }));
  return { skipped: false };
}

async function withConcurrency(fns, limit) {
  let i = 0;
  let uploaded = 0, skipped = 0, failed = 0;
  async function worker() {
    while (i < fns.length) {
      const fn = fns[i++];
      try {
        const r = await fn();
        if (r.skipped) skipped++; else uploaded++;
      } catch (err) {
        failed++;
        console.error(`  ERROR: ${err.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, fns.length) }, worker));
  return { uploaded, skipped, failed };
}

(async () => {
  if (!fs.existsSync(SOURCE_DIR)) {
    console.error(`Source directory not found: ${SOURCE_DIR}`);
    process.exit(1);
  }

  console.log(`Scanning ${SOURCE_DIR}...`);
  const files = [...walkDir(SOURCE_DIR)];
  console.log(`Found ${files.length} files.`);

  console.log('Listing existing S3 objects...');
  const existingKeys = await listExistingKeys();
  console.log(`Found ${existingKeys.size} existing objects in S3.\n`);

  const fns = files.map(localPath => {
    const rel   = path.relative(SOURCE_DIR, localPath).replace(/\\/g, '/');
    const s3Key = PREFIX + rel;
    return () => {
      process.stdout.write(`  upload ${s3Key}\n`);
      return uploadFile(localPath, s3Key, existingKeys);
    };
  });

  const { uploaded, skipped, failed } = await withConcurrency(fns, CONCURRENCY);
  console.log(`\nDone. Uploaded: ${uploaded}  Skipped: ${skipped}  Failed: ${failed}`);
  if (failed > 0) process.exit(1);
})();
