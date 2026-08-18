'use strict';

const {
  AthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
} = require('@aws-sdk/client-athena');

const athena   = new AthenaClient({});
const DATABASE = process.env.ATHENA_DATABASE;
const WORKGROUP = process.env.ATHENA_WORKGROUP;
const OUTPUT   = process.env.ATHENA_RESULTS_BUCKET;

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
    `SELECT id, run_type, completed_at, elapsed FROM runs ORDER BY CAST(id AS BIGINT) DESC`
  );
  return { statusCode: 200, body: runs };
}

async function getRunById(id) {
  if (!/^\d+$/.test(id)) return { statusCode: 400, body: { error: 'Invalid id' } };

  const [run] = await runQuery(
    `SELECT id, run_type, completed_at, elapsed FROM runs WHERE id = '${id}' LIMIT 1`
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
    `SELECT * FROM interception_sessions ORDER BY CAST(id AS BIGINT) DESC`
  );
  return { statusCode: 200, body: sessions };
}

async function getInterceptionById(id) {
  if (!/^\d+$/.test(id)) return { statusCode: 400, body: { error: 'Invalid id' } };

  const [session] = await runQuery(
    `SELECT * FROM interception_sessions WHERE id = '${id}' LIMIT 1`
  );
  if (!session) return { statusCode: 404, body: { error: `Session #${id} not found` } };

  const { action, fn, limit = '500', offset = '0' } = {};
  const calls = await runQuery(
    `SELECT * FROM interceptions WHERE session_id = '${id}' ORDER BY seq LIMIT 500`
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
  const q   = queryParams?.q || '';
  const pat = q ? q.replace(/'/g, "''") : '';
  const sql = pat
    ? `SELECT browser_label, name, value FROM window_elements
       WHERE type LIKE '%function%' AND name LIKE '%${pat}%'
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
