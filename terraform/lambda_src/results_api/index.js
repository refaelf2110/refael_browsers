'use strict';

const {
  AthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
} = require('@aws-sdk/client-athena');

const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');

const athena   = new AthenaClient({});
const DATABASE = process.env.ATHENA_DATABASE;
const WORKGROUP = process.env.ATHENA_WORKGROUP;
const OUTPUT   = process.env.ATHENA_RESULTS_BUCKET;

const s3 = new S3Client({});

// ── Athena helpers ────────────────────────────────────────────────────────────

async function runQuery(sql) {
  const start = await athena.send(new StartQueryExecutionCommand({
    QueryString:            sql,
    QueryExecutionContext:  { Database: DATABASE },
    WorkGroup:              WORKGROUP,
    ResultConfiguration:    { OutputLocation: OUTPUT },
  }));

  const execId = start.QueryExecutionId;

  // Poll until complete (max 55s — Lambda timeout is 60s)
  const deadline = Date.now() + 55_000;
  while (Date.now() < deadline) {
    const status = await athena.send(new GetQueryExecutionCommand({ QueryExecutionId: execId }));
    const state  = status.QueryExecution.Status.State;
    if (state === 'SUCCEEDED') break;
    if (state === 'FAILED' || state === 'CANCELLED') {
      throw new Error(`Athena query ${state}: ${status.QueryExecution.Status.StateChangeReason}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  const results = await athena.send(new GetQueryResultsCommand({ QueryExecutionId: execId }));
  return toRows(results);
}

/** Convert Athena ResultSet into an array of plain objects. */
function toRows(results) {
  const [header, ...dataRows] = results.ResultSet.Rows;
  const cols = header.Data.map(c => c.VarCharValue);
  return dataRows.map(row => {
    const obj = {};
    row.Data.forEach((cell, i) => { obj[cols[i]] = cell.VarCharValue ?? null; });
    return obj;
  });
}

// ── Route handlers ────────────────────────────────────────────────────────────

async function getRuns() {
  const runs = await runQuery(
    `SELECT id, run_type, completed_at, elapsed, platform FROM runs ORDER BY completed_at DESC`
  );
  return { statusCode: 200, body: runs };
}

async function getRunById(id) {
  // Allow alphanumeric, hyphens, dots, colons — covers JOB_IDs and ISO timestamps
  if (!/^[a-zA-Z0-9\-:.]+$/.test(id)) return { statusCode: 400, body: { error: 'Invalid id' } };

  const [run] = await runQuery(
    `SELECT id, run_type, completed_at, elapsed, platform FROM runs WHERE id = '${id}' LIMIT 1`
  );
  if (!run) return { statusCode: 404, body: { error: `Run #${id} not found` } };

  const results = await runQuery(
    `SELECT framework, label, major, mode, all_reasons, error
     FROM results WHERE run_id = '${id}' ORDER BY id`
  );

  return {
    statusCode: 200,
    body: {
      ...run,
      results: results.map(r => ({
        ...r,
        allReasons: JSON.parse(r.all_reasons || '[]'),
      })),
    },
  };
}

async function getInterceptions() {
  const sessions = await runQuery(
    `SELECT * FROM interception_sessions ORDER BY completed_at DESC`
  );
  return { statusCode: 200, body: sessions };
}

async function getInterceptionById(id) {
  if (!/^[a-zA-Z0-9\-]+$/.test(id)) return { statusCode: 400, body: { error: 'Invalid id' } };

  const [session] = await runQuery(
    `SELECT * FROM interception_sessions WHERE public_id = '${id}' OR (public_id IS NULL AND CAST(id AS TEXT) = '${id}') LIMIT 1`
  );
  if (!session) return { statusCode: 404, body: { error: `Session ${id} not found` } };

  const calls = await runQuery(
    `SELECT * FROM interceptions WHERE session_id = '${session.id}' ORDER BY seq LIMIT 500`
  );

  return { statusCode: 200, body: { session, calls } };
}

async function getExtractorBrowsers() {
  const rows = await runQuery(
    `SELECT DISTINCT browser_label FROM window_elements ORDER BY browser_label`
  );
  return { statusCode: 200, body: rows.map(r => r.browser_label) };
}

async function getExtractorDiff(queryParams) {
  const a = queryParams?.a;
  const b = queryParams?.b;
  if (!a || !b) return { statusCode: 400, body: { error: 'a and b query params required' } };

  const [rowsA, rowsB] = await Promise.all([
    runQuery(`SELECT name, type, value FROM window_elements WHERE browser_label = '${a.replace(/'/g, "''")}'`),
    runQuery(`SELECT name, type, value FROM window_elements WHERE browser_label = '${b.replace(/'/g, "''")}'`),
  ]);

  const mapA = new Map(rowsA.map(r => [r.name, r]));
  const mapB = new Map(rowsB.map(r => [r.name, r]));
  const names = new Set([...mapA.keys(), ...mapB.keys()]);

  const diff = [...names].sort().map(name => {
    const rA = mapA.get(name), rB = mapB.get(name);
    const status = rA && rB
      ? (rA.value === rB.value ? 'same' : 'diff')
      : (rA ? 'only-a' : 'only-b');
    return {
      name,
      type:   (rA || rB).type,
      valueA: rA?.value ?? null,
      valueB: rB?.value ?? null,
      status,
    };
  });

  return { statusCode: 200, body: diff };
}

async function getExtractorFunctions(queryParams) {
  const q      = queryParams?.q || '';
  const pat    = q ? q.replace(/'/g, "''").toLowerCase() : '';
  const sql = pat
    ? `SELECT browser_label, name, value FROM window_elements
       WHERE type LIKE '%function%' AND LOWER(name) LIKE '%${pat}%'
       ORDER BY name, browser_label`
    : `SELECT browser_label, name, value FROM window_elements
       WHERE type LIKE '%function%'
       ORDER BY name, browser_label`;

  const rows     = await runQuery(sql);
  const browsers = [...new Set(rows.map(r => r.browser_label))].sort();
  const funcMap  = new Map();

  for (const row of rows) {
    if (!funcMap.has(row.name)) funcMap.set(row.name, { name: row.name, support: {} });
    funcMap.get(row.name).support[row.browser_label] = row.value;
  }

  return {
    statusCode: 200,
    body: {
      browsers,
      functions: [...funcMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    },
  };
}

async function getBrowsersNew() {
  // Fetch upstream Chrome versions (one latest patch per major)
  const chromeResp = await fetch('https://googlechromelabs.github.io/chrome-for-testing/known-good-versions-with-downloads.json');
  if (!chromeResp.ok) throw new Error('Failed to fetch Chrome versions from upstream');
  const chromeData = await chromeResp.json();

  const majorMap = new Map();
  for (const v of chromeData.versions) {
    const major = parseInt(v.version.split('.')[0], 10);
    if (!majorMap.has(major)) {
      majorMap.set(major, v.version);
    } else {
      const ex = majorMap.get(major).split('.').map(Number);
      const cu = v.version.split('.').map(Number);
      for (let i = 0; i < 4; i++) {
        if ((cu[i] || 0) > (ex[i] || 0)) { majorMap.set(major, v.version); break; }
        if ((cu[i] || 0) < (ex[i] || 0)) break;
      }
    }
  }
  const allChrome = [...majorMap.values()].sort((a, b) => {
    const ap = a.split('.').map(Number), bp = b.split('.').map(Number);
    for (let i = 0; i < 4; i++) { const d = (bp[i]||0)-(ap[i]||0); if (d) return d; }
    return 0;
  });

  // Fetch upstream Firefox versions (all majors >= 86)
  const ffResp = await fetch('https://product-details.mozilla.org/1.0/firefox.json');
  if (!ffResp.ok) throw new Error('Failed to fetch Firefox versions from upstream');
  const ffData = await ffResp.json();
  const ffMajors = new Set();
  for (const rel of Object.values(ffData.releases)) {
    if (rel.product === 'firefox' && rel.version) {
      const major = parseInt(rel.version.split('.')[0], 10);
      if (major >= 86) ffMajors.add(String(major));
    }
  }
  const allFirefox = [...ffMajors].sort((a, b) => parseInt(b, 10) - parseInt(a, 10));

  // Get what's already cached in S3
  const cachedResult = await getBrowsersAvailable();
  const cached = cachedResult.body;

  const chromeMajor = v => parseInt(v.split('.')[0], 10);

  const result = {};
  for (const os of ['windows', 'linux']) {
    const cachedChromeMajors = new Set((cached[os]?.chrome || []).map(chromeMajor));
    const cachedFirefoxMajors = new Set((cached[os]?.firefox || []).map(v => String(parseInt(v, 10))));
    result[os] = {
      chrome:  { cached: cached[os]?.chrome  || [], new: allChrome.filter(v => !cachedChromeMajors.has(chromeMajor(v))) },
      firefox: { cached: cached[os]?.firefox || [], new: allFirefox.filter(v => !cachedFirefoxMajors.has(v)) },
    };
  }

  return { statusCode: 200, body: result };
}

async function getDashboardCombined() {
  const bucket = process.env.RESULTS_BUCKET;
  if (!bucket) return { statusCode: 500, body: { error: 'RESULTS_BUCKET not configured' } };

  try {
    const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: 'dashboard/combined.json' }));
    const chunks = [];
    for await (const chunk of resp.Body) chunks.push(chunk);
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return { statusCode: 200, body: data };
  } catch (e) {
    if (e.name === 'NoSuchKey') {
      return { statusCode: 404, body: { error: 'No combined dashboard yet. Run a detection job first.' } };
    }
    throw e;
  }
}

async function getBrowsersAvailable() {
  const BROWSERS_BUCKET = process.env.BROWSERS_CACHE_BUCKET;
  if (!BROWSERS_BUCKET) throw new Error('BROWSERS_CACHE_BUCKET env var is not set');

  // List both prefixes in parallel
  async function listPrefix(prefix) {
    const keys = [];
    let token;
    do {
      const resp = await s3.send(new ListObjectsV2Command({
        Bucket:            BROWSERS_BUCKET,
        Prefix:            prefix,
        ContinuationToken: token,
      }));
      for (const obj of (resp.Contents || [])) {
        if (!obj.Key.endsWith('/') && !obj.Key.endsWith('.keep')) {
          keys.push(obj.Key.slice(prefix.length)); // relative to prefix
        }
      }
      token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }

  const [windowsKeys, linuxKeys] = await Promise.all([
    listPrefix('windows/'),
    listPrefix('linux/'),
  ]);

  // Numeric semver-style descending comparator
  function compareVersionsDesc(a, b) {
    const ap = a.split('.').map(n => parseInt(n, 10) || 0);
    const bp = b.split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
      const d = (bp[i] || 0) - (ap[i] || 0); // descending
      if (d !== 0) return d;
    }
    return 0;
  }

  function parseKeys(keys) {
    const chromeSet  = new Set();
    const firefoxSet = new Set();

    for (const rel of keys) {
      // rel is relative to the OS prefix, e.g. "chrome/win64-131.0.6778.87/chrome-win64/chrome.exe"
      const parts = rel.split('/');
      const kind  = parts[0];
      const folder = parts[1] || '';

      if (kind === 'chrome') {
        // folder: win64-131.0.6778.87  or  linux64-131.0.6778.87
        const m = folder.match(/^(?:win64|linux(?:64)?)-(.+)$/);
        if (m) chromeSet.add(m[1]);
      } else if (kind === 'chromedriver') {
        // skip — implied by chrome
      } else if (kind === 'firefox') {
        // Windows folder: plain major number e.g. "135"
        // Linux folder:   "linux-135.0" (puppeteer format)
        const mWin   = folder.match(/^(\d+)$/);
        const mLinux = folder.match(/^linux-(\d+)\./);
        const major  = (mWin || mLinux)?.[1];
        if (major) firefoxSet.add(major);
      }
    }

    const chrome  = [...chromeSet].sort(compareVersionsDesc);
    const firefox = [...firefoxSet].sort((a, b) => parseInt(b, 10) - parseInt(a, 10));
    return { chrome, firefox };
  }

  const windows = parseKeys(windowsKeys);
  const linux   = parseKeys(linuxKeys);

  return { statusCode: 200, body: { windows, linux } };
}

// ── Router ────────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  const method  = event.httpMethod;
  const path    = event.path;
  const params  = event.pathParameters || {};
  const query   = event.queryStringParameters || {};

  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  try {
    let result;

    if      (method === 'GET' && path === '/runs')                           result = await getRuns();
    else if (method === 'GET' && path.startsWith('/runs/'))                  result = await getRunById(params.id);
    else if (method === 'GET' && path === '/interceptions')                  result = await getInterceptions();
    else if (method === 'GET' && path.startsWith('/interceptions/'))         result = await getInterceptionById(params.id);
    else if (method === 'GET' && path === '/extractor/browsers')             result = await getExtractorBrowsers();
    else if (method === 'GET' && path === '/extractor/diff')                 result = await getExtractorDiff(query);
    else if (method === 'GET' && path === '/extractor/functions')            result = await getExtractorFunctions(query);
    else if (method === 'GET' && path === '/dashboard/combined')             result = await getDashboardCombined();
    else if (method === 'GET' && path === '/browsers/available')             result = await getBrowsersAvailable();
    else if (method === 'GET' && path === '/browsers/new')                   result = await getBrowsersNew();
    else result = { statusCode: 404, body: { error: 'Not found' } };

    return {
      statusCode: result.statusCode,
      headers:    cors,
      body:       JSON.stringify(result.body),
    };
  } catch (err) {
    console.error('Handler error:', err);
    return {
      statusCode: 500,
      headers:    cors,
      body:       JSON.stringify({ error: err.message }),
    };
  }
};
