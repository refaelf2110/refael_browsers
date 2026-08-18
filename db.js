'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const { EXCLUDED_REASONS } = require('./generate_html');

const DB_PATH = 'C:\\browsers\\results.db';

let _db;

function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        run_type     TEXT    NOT NULL,
        completed_at TEXT    NOT NULL,
        elapsed      TEXT    NOT NULL
      );
      CREATE TABLE IF NOT EXISTS results (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id      INTEGER NOT NULL REFERENCES runs(id),
        framework   TEXT    NOT NULL,
        label       TEXT    NOT NULL,
        major       TEXT    NOT NULL,
        mode        TEXT    NOT NULL,
        all_reasons TEXT    NOT NULL,
        error       TEXT
      );
      CREATE TABLE IF NOT EXISTS window_elements (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        browser_label  TEXT    NOT NULL,
        collected_at   TEXT    NOT NULL,
        name           TEXT,
        type           TEXT,
        value          TEXT,
        raw            TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_we_browser      ON window_elements(browser_label);
      CREATE INDEX IF NOT EXISTS idx_we_browser_name ON window_elements(browser_label, name, id);
      CREATE INDEX IF NOT EXISTS idx_we_type         ON window_elements(type);

      CREATE TABLE IF NOT EXISTS interception_sessions (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        framework     TEXT    NOT NULL,
        browser_label TEXT    NOT NULL,
        started_at    TEXT    NOT NULL,
        completed_at  TEXT,
        action_count  INTEGER DEFAULT 0,
        call_count    INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS interceptions (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id     INTEGER NOT NULL REFERENCES interception_sessions(id),
        seq            INTEGER NOT NULL,
        action         TEXT    NOT NULL,
        fn_name        TEXT    NOT NULL,
        args_json      TEXT,
        this_arg       TEXT,
        caller         TEXT,
        return_val     TEXT,
        is_constructor INTEGER DEFAULT 0,
        duration_ms    REAL    DEFAULT 0,
        stack          TEXT,
        triggered_at   INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ic_session    ON interceptions(session_id);
      CREATE INDEX IF NOT EXISTS idx_ic_fn         ON interceptions(fn_name);
      CREATE INDEX IF NOT EXISTS idx_ic_action     ON interceptions(session_id, action);
    `);
    /* Migrate existing databases that pre-date the new columns. */
    const newCols = [
      'ALTER TABLE interceptions ADD COLUMN this_arg       TEXT',
      'ALTER TABLE interceptions ADD COLUMN caller         TEXT',
      'ALTER TABLE interceptions ADD COLUMN return_val     TEXT',
      'ALTER TABLE interceptions ADD COLUMN is_constructor INTEGER DEFAULT 0',
      'ALTER TABLE interceptions ADD COLUMN duration_ms    REAL    DEFAULT 0',
    ];
    for (const sql of newCols) {
      try { _db.exec(sql); } catch (_e) { /* already exists */ }
    }
  }
  return _db;
}

/**
 * Persist a completed run and its results to the database.
 *
 * @param {string} runType  - 'mini' or 'full'
 * @param {string} elapsed  - human-readable elapsed string, e.g. "8m 28s"
 * @param {Array}  results  - array of result objects from the run scripts
 * @returns {number}        - inserted run id
 */
function saveRun(runType, elapsed, results) {
  const db = getDb();
  const completedAt = new Date().toISOString();

  const { lastInsertRowid: runId } = db.prepare(
    'INSERT INTO runs (run_type, completed_at, elapsed) VALUES (?, ?, ?)'
  ).run(runType, completedAt, elapsed);

  const insertResult = db.prepare(
    'INSERT INTO results (run_id, framework, label, major, mode, all_reasons, error) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  db.transaction(rs => {
    for (const r of rs) {
      insertResult.run(
        runId,
        r.framework,
        r.label,
        r.major,
        r.mode,
        JSON.stringify(r.allReasons || []),
        r.error || null
      );
    }
  })(results);

  console.log(`[db] Saved run #${runId} (${runType}) — ${results.length} results at ${completedAt}`);
  return runId;
}

/**
 * Load the most recent run of a given type, including all its results.
 * Returns null if no run of that type exists.
 */
function getLatestRun(runType) {
  const db = getDb();
  const run = db.prepare(
    'SELECT * FROM runs WHERE run_type = ? ORDER BY id DESC LIMIT 1'
  ).get(runType);

  if (!run) return null;

  const rows = db.prepare(
    'SELECT * FROM results WHERE run_id = ? ORDER BY id'
  ).all(run.id);

  run.results = rows.map(r => {
    const allReasons = JSON.parse(r.all_reasons);
    return {
      framework:       r.framework,
      label:           r.label,
      major:           r.major,
      mode:            r.mode,
      allReasons,
      positiveReasons: allReasons.filter(x => !EXCLUDED_REASONS.has(x)),
      error:           r.error || null,
    };
  });

  return run;
}

/**
 * Load a specific run by id, including all its results.
 * Returns null if not found.
 */
function getRunById(id) {
  const db = getDb();
  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(id);
  if (!run) return null;

  const rows = db.prepare(
    'SELECT * FROM results WHERE run_id = ? ORDER BY id'
  ).all(run.id);

  run.results = rows.map(r => {
    const allReasons = JSON.parse(r.all_reasons);
    return {
      framework:       r.framework,
      label:           r.label,
      major:           r.major,
      mode:            r.mode,
      allReasons,
      positiveReasons: allReasons.filter(x => !EXCLUDED_REASONS.has(x)),
      error:           r.error || null,
    };
  });

  return run;
}

/**
 * Return a list of all runs (no results), newest first.
 */
function getAllRuns() {
  return getDb().prepare(
    'SELECT id, run_type, completed_at, elapsed FROM runs ORDER BY id DESC'
  ).all();
}

// ── window_elements helpers ────────────────────────────────────────────────────

/**
 * Parse a single vars_result string line into its named fields.
 * Handles both normal " /Key: value" separators and the no-space variant
 * "/Type: raised_exception/Value: ..." produced by the extractor page.
 */
function parseExtractorLine(raw) {
  const parts = raw.split(/ ?\/([A-Za-z]+): /);
  const result = {};
  for (let i = 1; i < parts.length - 1; i += 2) {
    result[parts[i].toLowerCase()] = parts[i + 1].trim();
  }
  return result;
}

/**
 * Persist window_elements rows for one browser label.
 * Replaces any existing rows for that label so re-runs stay fresh.
 */
function saveWindowElements(browserLabel, rawLines) {
  const db = getDb();
  const collectedAt = new Date().toISOString();
  db.prepare('DELETE FROM window_elements WHERE browser_label = ?').run(browserLabel);
  const ins = db.prepare(
    'INSERT INTO window_elements (browser_label, collected_at, name, type, value, raw) VALUES (?,?,?,?,?,?)'
  );
  db.transaction(lines => {
    for (const raw of lines) {
      const p = parseExtractorLine(raw);
      ins.run(browserLabel, collectedAt, p.name || null, p.type || null, p.value || null, raw);
    }
  })(rawLines);
  console.log(`[extractor] Saved ${rawLines.length} rows for ${browserLabel}`);
}

/** Return the distinct browser labels that have window_elements data, sorted. */
function getWindowElementBrowsers() {
  return getDb()
    .prepare('SELECT DISTINCT browser_label FROM window_elements ORDER BY browser_label')
    .all()
    .map(r => r.browser_label);
}

/**
 * Return one row per unique name for a given browser label.
 * When the extractor stores multiple rows for the same name (e.g. raised_exception
 * followed by the function result) we keep the highest-id (latest) row.
 */
function getWindowElements(browserLabel) {
  // Use a covering scan on idx_we_browser_name (browser_label, name, id) to find
  // the max id per name without a self-join, then fetch only those rows.
  const rows = getDb().prepare(`
    SELECT name, type, value, MAX(id) AS maxid
    FROM window_elements
    WHERE browser_label = ?
    GROUP BY name
    ORDER BY name
  `).all(browserLabel);
  return rows.map(r => ({ name: r.name, type: r.type, value: r.value }));
}

/**
 * Search for function-type entries matching a name pattern.
 * Returns { browsers: string[], functions: [{name, support: {browser_label: value}}] }
 */
function searchWindowFunctions(namePattern) {
  const db  = getDb();
  const pat = namePattern ? `%${namePattern}%` : '%';

  const rows = db.prepare(`
    SELECT w.browser_label, w.name, w.value
    FROM window_elements w
    INNER JOIN (
      SELECT name, browser_label, MAX(id) AS maxid
      FROM window_elements
      WHERE (type LIKE '%function%') AND name LIKE ?
      GROUP BY browser_label, name
    ) m ON w.id = m.maxid
    ORDER BY w.name, w.browser_label
  `).all(pat);

  const browsers  = [...new Set(rows.map(r => r.browser_label))].sort();
  const funcMap   = new Map();
  for (const row of rows) {
    if (!funcMap.has(row.name)) funcMap.set(row.name, { name: row.name, support: {} });
    funcMap.get(row.name).support[row.browser_label] = row.value;
  }

  return {
    browsers,
    functions: [...funcMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// ── interception_sessions helpers ────────────────────────────────────────────

/** Create a new interception session and return its id. */
function createInterceptionSession(framework, browserLabel) {
  const db = getDb();
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO interception_sessions (framework, browser_label, started_at) VALUES (?, ?, ?)'
  ).run(framework, browserLabel, new Date().toISOString());
  console.log(`[interceptions] Session #${lastInsertRowid} started — ${browserLabel}`);
  return Number(lastInsertRowid);
}

/** Update completed_at and recount totals from the interceptions table. */
function finalizeInterceptionSession(sessionId) {
  const db = getDb();
  const counts = db.prepare(
    'SELECT COUNT(*) AS calls, COUNT(DISTINCT action) AS actions FROM interceptions WHERE session_id = ?'
  ).get(sessionId);
  db.prepare(
    'UPDATE interception_sessions SET completed_at = ?, call_count = ?, action_count = ? WHERE id = ?'
  ).run(new Date().toISOString(), counts.calls, counts.actions, sessionId);
  console.log(`[interceptions] Session #${sessionId} done — ${counts.calls} calls, ${counts.actions} actions`);
}

/**
 * Bulk-insert intercepted call entries for a session.
 * Each entry: { seq, action, fn, args: string[], stack, time }
 */
function saveInterceptions(sessionId, calls) {
  if (!calls || calls.length === 0) return;
  const db  = getDb();
  const ins = db.prepare(
    `INSERT INTO interceptions
       (session_id, seq, action, fn_name, args_json,
        this_arg, caller, return_val, is_constructor, duration_ms, stack, triggered_at)
     VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?)`
  );
  db.transaction(cs => {
    for (const c of cs) {
      ins.run(
        sessionId,
        c.seq,
        c.action        || '',
        c.fn            || '',
        c.args          ? JSON.stringify(c.args) : null,
        c.thisArg       != null ? String(c.thisArg)   : null,
        c.caller        != null ? String(c.caller)    : null,
        c.returnVal     != null ? String(c.returnVal) : null,
        c.isConstructor ? 1 : 0,
        c.duration      || 0,
        c.stack         ? String(c.stack).slice(0, 3000) : null,
        c.time          || 0,
      );
    }
  })(calls);
}

/** Return all sessions, newest first. */
function getInterceptionSessions() {
  return getDb().prepare(
    'SELECT * FROM interception_sessions ORDER BY id DESC'
  ).all();
}

/** Return one session row by id. */
function getInterceptionSession(id) {
  return getDb().prepare('SELECT * FROM interception_sessions WHERE id = ?').get(id) || null;
}

/**
 * Return interceptions for a session, optionally filtered.
 * @param {number} sessionId
 * @param {object} [opts]  { action?: string, fn?: string, limit?: number, offset?: number }
 */
function getInterceptions(sessionId, opts = {}) {
  const db     = getDb();
  const wheres = ['session_id = ?'];
  const params = [sessionId];
  if (opts.action) { wheres.push('action = ?');            params.push(opts.action); }
  if (opts.fn)     { wheres.push('fn_name LIKE ?');        params.push('%' + opts.fn + '%'); }
  const limit  = opts.limit  || 2000;
  const offset = opts.offset || 0;
  return db.prepare(
    `SELECT * FROM interceptions WHERE ${wheres.join(' AND ')} ORDER BY seq LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);
}

/** Distinct actions for a session (for filter UI). */
function getInterceptionActions(sessionId) {
  return getDb().prepare(
    'SELECT DISTINCT action, COUNT(*) AS cnt FROM interceptions WHERE session_id = ? GROUP BY action ORDER BY MIN(seq)'
  ).all(sessionId);
}

/** Top called functions for a session. */
function getTopInterceptedFunctions(sessionId, limit = 50) {
  return getDb().prepare(
    'SELECT fn_name, COUNT(*) AS cnt FROM interceptions WHERE session_id = ? GROUP BY fn_name ORDER BY cnt DESC LIMIT ?'
  ).all(sessionId, limit);
}

module.exports = {
  saveRun, getLatestRun, getRunById, getAllRuns,
  saveWindowElements, getWindowElementBrowsers, getWindowElements, searchWindowFunctions,
  createInterceptionSession, finalizeInterceptionSession, saveInterceptions,
  getInterceptionSessions, getInterceptionSession, getInterceptions,
  getInterceptionActions, getTopInterceptedFunctions,
};
