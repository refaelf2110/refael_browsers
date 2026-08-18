'use strict';

/**
 * sync_browsers_from_s3.js
 *
 * Downloads browser binaries from S3 into C:\browsers at container startup,
 * replacing the old internet-download approach.
 *
 * Environment variables (set by ECS task definition):
 *   BROWSERS_CACHE_BUCKET          — S3 bucket name (e.g. refael-browsers-cache)
 *   BROWSERS_CACHE_WINDOWS_PREFIX  — S3 prefix    (e.g. windows/)
 *
 * Optional override:
 *   BROWSER_FILTER  — comma-separated list of browser kinds to sync.
 *                     Supported values: chrome, chromedriver, firefox,
 *                     geckodriver, selenium-manager
 *                     Default: all folders.
 *                     Example: BROWSER_FILTER=chrome,chromedriver
 */

const fs   = require('fs');
const path = require('path');
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { pipeline } = require('stream/promises');

const BUCKET   = process.env.BROWSERS_CACHE_BUCKET;
const PREFIX   = process.env.BROWSERS_CACHE_WINDOWS_PREFIX || 'windows/';
const DEST_DIR = 'C:\\browsers';
const CONCURRENCY = 8;

if (!BUCKET) {
  console.error('BROWSERS_CACHE_BUCKET env var is not set.');
  process.exit(1);
}

const BROWSER_FILTER = process.env.BROWSER_FILTER
  ? new Set(process.env.BROWSER_FILTER.split(',').map(s => s.trim().toLowerCase()))
  : null;

const s3 = new S3Client({ region: process.env.AWS_DEFAULT_REGION || 'us-east-1' });

// List all S3 objects under the prefix, optionally filtered by browser kind.
async function listObjects() {
  const objects = [];
  let token;
  do {
    const resp = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: PREFIX,
      ContinuationToken: token,
    }));
    for (const obj of (resp.Contents || [])) {
      if (obj.Key.endsWith('/') || obj.Key.endsWith('.keep')) continue;

      // Determine the browser kind from the first path segment after the prefix.
      // e.g. "windows/chrome/win64-131.0.6778.87/..." → kind = "chrome"
      const rel  = obj.Key.slice(PREFIX.length);
      const kind = rel.split('/')[0].toLowerCase();

      if (BROWSER_FILTER && !BROWSER_FILTER.has(kind)) continue;
      objects.push({ key: obj.Key, size: obj.Size, rel });
    }
    token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (token);
  return objects;
}

async function downloadObject(key, localPath, size) {
  const stat = fs.existsSync(localPath) ? fs.statSync(localPath) : null;
  if (stat && stat.size === size) {
    return false; // already cached
  }
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  const resp = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  await pipeline(resp.Body, fs.createWriteStream(localPath));
  return true;
}

async function withConcurrency(fns, limit) {
  let i = 0;
  let downloaded = 0, skipped = 0, failed = 0;
  async function worker() {
    while (i < fns.length) {
      const fn = fns[i++];
      try {
        const fetched = await fn();
        if (fetched) downloaded++; else skipped++;
      } catch (err) {
        failed++;
        console.error(`  ERROR: ${err.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, fns.length) }, worker));
  return { downloaded, skipped, failed };
}

(async () => {
  fs.mkdirSync(DEST_DIR, { recursive: true });

  const filter = BROWSER_FILTER ? `[${[...BROWSER_FILTER].join(', ')}]` : 'all';
  console.log(`\n[S3 Browser Sync] bucket=${BUCKET} prefix=${PREFIX} filter=${filter}`);

  console.log('Listing objects...');
  const objects = await listObjects();
  console.log(`${objects.length} objects to sync.\n`);

  const fns = objects.map(({ key, size, rel }) => {
    const localPath = path.join(DEST_DIR, rel.replace(/\//g, path.sep));
    return async () => {
      const fetched = await downloadObject(key, localPath, size);
      if (fetched) {
        console.log(`  downloaded  ${rel}`);
      } else {
        console.log(`  cached      ${rel}`);
      }
      return fetched;
    };
  });

  const { downloaded, skipped, failed } = await withConcurrency(fns, CONCURRENCY);
  console.log(`\n[S3 Browser Sync] Done. Downloaded: ${downloaded}  Cached: ${skipped}  Failed: ${failed}`);
  if (failed > 0) {
    console.error('Some downloads failed — aborting.');
    process.exit(1);
  }
})();
