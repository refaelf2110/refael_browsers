'use strict';

/**
 * sync_browsers_from_s3.js
 *
 * Downloads browser binaries from S3 into C:\browsers at container startup.
 *
 * Environment variables (set by ECS task definition / job runner overrides):
 *   BROWSERS_CACHE_BUCKET          — S3 bucket name (e.g. refael-browsers-cache)
 *   BROWSERS_CACHE_WINDOWS_PREFIX  — S3 prefix    (e.g. windows/)
 *   BROWSER_FILTER   — comma-separated kinds to sync: chrome,chromedriver,firefox,geckodriver,selenium-manager
 *                      Omit to sync everything.
 *   MAX_VERSIONS     — keep only the N most-recent versions per browser kind (0 = unlimited).
 *                      Applies to versioned folders like chrome/win64-{version}/...
 *   VERSION_LIST     — JSON object mapping browser kind to exact version strings to include,
 *                      e.g. {"chrome":["131.0.6778.87"],"firefox":["152"]}.
 *                      Overrides MAX_VERSIONS for kinds that appear in it; other kinds still
 *                      use MAX_VERSIONS.
 */

const fs   = require('fs');
const path = require('path');
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { pipeline } = require('stream/promises');

const BUCKET      = process.env.BROWSERS_CACHE_BUCKET;
const PREFIX      = process.env.BROWSERS_CACHE_WINDOWS_PREFIX || 'windows/';
const DEST_DIR    = 'C:\\browsers';
const CONCURRENCY = 8;
const MAX_VERSIONS = process.env.MAX_VERSIONS ? parseInt(process.env.MAX_VERSIONS, 10) : 0;

if (!BUCKET) {
  console.error('BROWSERS_CACHE_BUCKET env var is not set.');
  process.exit(1);
}

const BROWSER_FILTER = process.env.BROWSER_FILTER
  ? new Set(process.env.BROWSER_FILTER.split(',').map(s => s.trim().toLowerCase()))
  : null;

// VERSION_LIST: { chrome: ["131.0.6778.87", ...], firefox: ["152", ...] }
let VERSION_LIST = null;
if (process.env.VERSION_LIST) {
  try {
    VERSION_LIST = JSON.parse(process.env.VERSION_LIST);
  } catch (err) {
    console.error('Failed to parse VERSION_LIST env var as JSON:', err.message);
    process.exit(1);
  }
}

const s3 = new S3Client({ region: process.env.AWS_DEFAULT_REGION || 'us-east-1' });

// ── version sorting ──────────────────────────────────────────────────────────

function compareVersions(a, b) {
  const ap = a.split('.').map(n => parseInt(n, 10) || 0);
  const bp = b.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const d = (ap[i] || 0) - (bp[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

// Filter objects by explicit version lists from VERSION_LIST.
// For each kind that appears in versionList, keep only objects whose win64-{version}
// matches one of the listed versions. Kinds not in versionList are left untouched
// (returned as-is) so applyVersionLimit can handle them.
function applyVersionList(objects, versionList) {
  if (!versionList) return objects;

  const kept = [];
  for (const obj of objects) {
    const parts = obj.rel.split('/');
    const kind  = parts[0];
    const folder = parts[1] || '';
    const m     = folder.match(/^win64-(.+)$/);

    if (versionList[kind] !== undefined) {
      // This kind is controlled by VERSION_LIST — keep only exact matches
      if (m && versionList[kind].includes(m[1])) {
        kept.push(obj);
      }
      // Objects for this kind that don't match the win64-{version} pattern are dropped
      // (they'd be stray files outside a versioned folder — safe to skip)
    } else {
      // Kind not in VERSION_LIST — pass through for MAX_VERSIONS handling
      kept.push(obj);
    }
  }

  // Log what was selected per controlled kind
  for (const kind of Object.keys(versionList)) {
    const selected = kept.filter(o => o.rel.split('/')[0] === kind);
    const versions = [...new Set(
      selected.map(o => { const m = (o.rel.split('/')[1] || '').match(/^win64-(.+)$/); return m ? m[1] : null; })
              .filter(Boolean)
    )];
    console.log(`  ${kind}: VERSION_LIST pinned to [${versionList[kind].join(', ')}], matched ${versions.length} version(s)`);
  }

  return kept;
}

// Keep only the MAX_VERSIONS most-recent versions per kind (win64-{version} folders).
// Skips any kind that was handled by VERSION_LIST (those objects are already filtered).
// Objects that don't match the win64- pattern are always kept.
function applyVersionLimit(objects, maxVersions) {
  if (!maxVersions) return objects;

  // Separate versioned (win64-X) from unversioned objects
  const byKindVersion = new Map(); // `${kind}::${version}` → [obj, ...]
  const unversioned = [];

  for (const obj of objects) {
    const parts = obj.rel.split('/');
    const kind  = parts[0];
    const m     = parts[1] && parts[1].match(/^win64-(.+)$/);
    if (m) {
      // Skip kinds already pinned by VERSION_LIST
      if (VERSION_LIST && VERSION_LIST[kind] !== undefined) {
        unversioned.push(obj); // treat as already-resolved, pass through
        continue;
      }
      const key = `${kind}::${m[1]}`;
      if (!byKindVersion.has(key)) byKindVersion.set(key, []);
      byKindVersion.get(key).push(obj);
    } else {
      unversioned.push(obj);
    }
  }

  // Group by kind, sort versions ascending, keep last maxVersions
  const byKind = new Map();
  for (const [key, objs] of byKindVersion) {
    const [kind, version] = key.split('::');
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push({ version, objs });
  }

  const kept = [...unversioned];
  for (const [kind, versions] of byKind) {
    versions.sort((a, b) => compareVersions(a.version, b.version));
    const selected = versions.slice(-maxVersions);
    console.log(`  ${kind}: keeping ${selected.length} of ${versions.length} versions (newest ${maxVersions})`);
    for (const { objs } of selected) kept.push(...objs);
  }
  return kept;
}

// ── S3 listing ───────────────────────────────────────────────────────────────

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
      const rel  = obj.Key.slice(PREFIX.length);
      const kind = rel.split('/')[0].toLowerCase();
      if (BROWSER_FILTER && !BROWSER_FILTER.has(kind)) continue;
      objects.push({ key: obj.Key, size: obj.Size, rel });
    }
    token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (token);
  return objects;
}

// ── download ─────────────────────────────────────────────────────────────────

async function downloadObject(key, localPath, size) {
  const stat = fs.existsSync(localPath) ? fs.statSync(localPath) : null;
  if (stat && stat.size === size) return false; // already cached
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  const resp = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  await pipeline(resp.Body, fs.createWriteStream(localPath));
  return true;
}

async function withConcurrency(fns, limit) {
  let i = 0, downloaded = 0, skipped = 0, failed = 0;
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

// ── main ─────────────────────────────────────────────────────────────────────

(async () => {
  fs.mkdirSync(DEST_DIR, { recursive: true });

  const filterStr      = BROWSER_FILTER ? [...BROWSER_FILTER].join(',') : 'all';
  const versionListStr = VERSION_LIST ? JSON.stringify(VERSION_LIST) : 'none';
  console.log(`[S3 sync] bucket=${BUCKET} filter=${filterStr} max_versions=${MAX_VERSIONS || 'unlimited'} version_list=${versionListStr}`);

  console.log('Listing S3 objects...');
  let objects = await listObjects();
  console.log(`Found ${objects.length} objects before version filtering.`);

  // Apply VERSION_LIST first (pins specific versions for listed kinds)
  objects = applyVersionList(objects, VERSION_LIST);

  // Then apply MAX_VERSIONS for any remaining kinds not handled by VERSION_LIST
  objects = applyVersionLimit(objects, MAX_VERSIONS);
  console.log(`Syncing ${objects.length} objects to ${DEST_DIR}...\n`);

  const fns = objects.map(({ key, size, rel }) => {
    const localPath = path.join(DEST_DIR, rel.replace(/\//g, path.sep));
    return async () => {
      const fetched = await downloadObject(key, localPath, size);
      console.log(`  ${fetched ? 'downloaded' : 'cached    '} ${rel}`);
      return fetched;
    };
  });

  const { downloaded, skipped, failed } = await withConcurrency(fns, CONCURRENCY);
  console.log(`\n[S3 sync] downloaded=${downloaded} cached=${skipped} failed=${failed}`);
  if (failed > 0) { console.error('Some downloads failed — aborting.'); process.exit(1); }
})();
