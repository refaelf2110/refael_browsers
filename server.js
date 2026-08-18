'use strict';

const express = require('express');
const { generateHTML } = require('./generate_html');
const { getLatestRun, getRunById, getAllRuns,
        getWindowElementBrowsers, getWindowElements, searchWindowFunctions,
        getInterceptionSessions, getInterceptionSession, getInterceptions,
        getInterceptionActions, getTopInterceptedFunctions } = require('./db');

const app  = express();
const PORT = process.env.PORT || 8080;

// ── helpers ───────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function landingHTML(runs) {
  const latest = { mini: null, full: null };
  for (const r of runs) {
    if (!latest[r.run_type]) latest[r.run_type] = r;
  }

  const runRows = runs.map(r => {
    const label = r.run_type === 'mini' ? 'Mini' : 'Full';
    const badge = r.run_type === 'mini'
      ? '<span style="color:#58a6ff">Mini</span>'
      : '<span style="color:#3fb950">Full</span>';
    return `
      <tr>
        <td>${r.id}</td>
        <td>${badge}</td>
        <td style="font-family:monospace">${esc(r.completed_at)}</td>
        <td>${esc(r.elapsed)}</td>
        <td>
          <a href="/run/${r.id}">/run/${r.id}</a>
        </td>
      </tr>`;
  }).join('');

  const miniLink = latest.mini
    ? `<a href="/mini" style="color:#58a6ff">Latest Mini results</a> &nbsp;(run #${latest.mini.id}, ${esc(latest.mini.completed_at)})`
    : '<span style="color:#6e7681">No mini run yet</span>';
  const fullLink = latest.full
    ? `<a href="/full" style="color:#3fb950">Latest Full results</a> &nbsp;(run #${latest.full.id}, ${esc(latest.full.completed_at)})`
    : '<span style="color:#6e7681">No full run yet</span>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Browser Detection Matrix — Dashboard</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',Tahoma,sans-serif;background:#0d1117;color:#c9d1d9;padding:32px;min-height:100vh}
    h1{font-size:24px;color:#58a6ff;margin-bottom:8px}
    .sub{font-size:13px;color:#8b949e;margin-bottom:28px}
    .nav{font-size:13px;color:#8b949e;margin-bottom:20px}
    .latest{display:flex;gap:24px;flex-wrap:wrap;margin-bottom:32px}
    .card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px 22px;font-size:14px}
    h2{font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:#8b949e;margin-bottom:16px}
    table{width:100%;border-collapse:collapse;font-size:13px}
    th{text-align:left;padding:8px 12px;color:#8b949e;font-weight:500;border-bottom:1px solid #21262d}
    td{padding:8px 12px;border-bottom:1px solid #161b22;vertical-align:middle}
    tr:hover td{background:#161b22}
    a{color:#58a6ff;text-decoration:none}
    a:hover{text-decoration:underline}
    .empty{color:#6e7681;padding:20px;text-align:center}
  </style>
</head>
<body>
  <h1>Browser Detection Matrix</h1>
  <p class="sub">Local results dashboard — data served from SQLite database</p>
  <p class="nav">
    <a href="/diff">Property Diff</a> &nbsp;|&nbsp;
    <a href="/canirun">Can I Run</a> &nbsp;|&nbsp;
    <a href="/interceptions" style="color:#f0883e">Interceptions</a>
  </p>
  <div class="latest">
    <div class="card">${miniLink}</div>
    <div class="card">${fullLink}</div>
  </div>
  <h2>All Runs</h2>
  ${runs.length === 0
    ? '<p class="empty">No runs stored yet. Run <code>node run_mini.js</code> or <code>node run_all.js</code> to populate the database.</p>'
    : `<table>
        <thead><tr><th>#</th><th>Type</th><th>Completed at</th><th>Elapsed</th><th>Link</th></tr></thead>
        <tbody>${runRows}</tbody>
      </table>`}
</body>
</html>`;
}

// ── routes ────────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  const runs = getAllRuns();
  res.send(landingHTML(runs));
});

app.get('/mini', (req, res) => {
  const run = getLatestRun('mini');
  if (!run) return res.status(404).send('<h1 style="font-family:sans-serif;padding:32px;color:#f85149">No mini results in database yet.<br><br>Run <code>node run_mini.js</code> first.</h1>');
  res.send(generateHTML(run.results, run.elapsed, 'Mini', run.completed_at));
});

app.get('/full', (req, res) => {
  const run = getLatestRun('full');
  if (!run) return res.status(404).send('<h1 style="font-family:sans-serif;padding:32px;color:#f85149">No full results in database yet.<br><br>Run <code>node run_all.js</code> first.</h1>');
  res.send(generateHTML(run.results, run.elapsed, 'Full', run.completed_at));
});

app.get('/run/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).send('Invalid run id');
  const run = getRunById(id);
  if (!run) return res.status(404).send(`Run #${id} not found`);
  const label = run.run_type === 'mini' ? 'Mini' : 'Full';
  res.send(generateHTML(run.results, run.elapsed, `${label} #${run.id}`, run.completed_at));
});

// ── Extractor API ─────────────────────────────────────────────────────────────

app.get('/api/extractor/browsers', (_req, res) => {
  res.json(getWindowElementBrowsers());
});

app.get('/api/extractor/diff', (req, res) => {
  const { a, b } = req.query;
  if (!a || !b) return res.status(400).json({ error: 'a and b required' });
  const mapA = new Map(getWindowElements(a).map(r => [r.name, r]));
  const mapB = new Map(getWindowElements(b).map(r => [r.name, r]));
  const names = new Set([...mapA.keys(), ...mapB.keys()]);
  const diff  = [...names].sort().map(name => {
    const rA = mapA.get(name), rB = mapB.get(name);
    const status = rA && rB ? (rA.value === rB.value ? 'same' : 'diff') : (rA ? 'only-a' : 'only-b');
    return { name, type: (rA || rB).type, valueA: rA?.value ?? null, valueB: rB?.value ?? null, status };
  });
  res.json(diff);
});

app.get('/api/extractor/functions', (req, res) => {
  res.json(searchWindowFunctions(req.query.q || ''));
});

// ── Extractor pages ───────────────────────────────────────────────────────────

app.get('/diff', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Browser Property Diff</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',Tahoma,sans-serif;background:#0d1117;color:#c9d1d9;padding:32px;min-height:100vh}
    h1{font-size:22px;color:#58a6ff;margin-bottom:20px}
    .controls{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;margin-bottom:18px}
    label{font-size:12px;color:#8b949e;display:block;margin-bottom:4px}
    select{background:#161b22;color:#c9d1d9;border:1px solid #30363d;padding:7px 12px;border-radius:6px;font-size:13px;min-width:260px}
    .btns{display:flex;gap:8px;flex-wrap:wrap}
    button{background:#21262d;color:#c9d1d9;border:1px solid #30363d;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:13px}
    button:hover{background:#30363d}
    button.active{background:#1f6feb;border-color:#1f6feb;color:#fff}
    #status{font-size:13px;color:#8b949e;margin-bottom:14px;min-height:18px}
    table{width:100%;border-collapse:collapse;font-size:12px;font-family:monospace}
    th{position:sticky;top:0;background:#161b22;color:#8b949e;padding:7px 10px;text-align:left;border-bottom:1px solid #30363d;font-weight:500;font-family:'Segoe UI',sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
    td{padding:5px 10px;border-bottom:1px solid #0d1117;vertical-align:top;word-break:break-all;max-width:380px}
    tr.same td{opacity:.35}
    tr.diff .name{color:#f0883e}
    tr.only-a .name{color:#3fb950}
    tr.only-b .name{color:#58a6ff}
    .badge{display:inline-block;padding:1px 7px;border-radius:3px;font-size:10px;font-family:'Segoe UI',sans-serif}
    .bs{background:#1f6feb22;color:#58a6ff}.bd{background:#db613022;color:#f0883e}
    .ba{background:#2ea04322;color:#3fb950}.bb{background:#1f6feb22;color:#58a6ff}
    a{color:#58a6ff;text-decoration:none;font-size:13px}a:hover{text-decoration:underline}
  </style>
</head>
<body>
  <h1>Browser Property Diff</h1>
  <p style="color:#8b949e;font-size:13px;margin-bottom:20px"><a href="/">← Dashboard</a> &nbsp;|&nbsp; <a href="/canirun">Can I Run →</a></p>
  <div class="controls">
    <div><label>Browser A</label><select id="selA"><option value="">Loading…</option></select></div>
    <div><label>Browser B</label><select id="selB"><option value="">Loading…</option></select></div>
    <button onclick="loadDiff()" style="background:#1f6feb;border-color:#1f6feb;color:#fff">Compare</button>
    <div class="btns">
      <button class="active" onclick="setFilter('all',this)">All</button>
      <button onclick="setFilter('diff',this)">Differences</button>
      <button onclick="setFilter('only-a',this)">Only A</button>
      <button onclick="setFilter('only-b',this)">Only B</button>
      <button onclick="setFilter('same',this)">Same</button>
    </div>
  </div>
  <div id="status">Select two browsers and click Compare.</div>
  <table id="tbl" style="display:none">
    <thead><tr><th>Name</th><th>Type</th><th>Value A</th><th>Value B</th><th></th></tr></thead>
    <tbody id="tbody"></tbody>
  </table>
<script>
let allRows=[], curFilter='all';
fetch('/api/extractor/browsers').then(r=>r.json()).then(bs=>{
  const sA=document.getElementById('selA'), sB=document.getElementById('selB');
  sA.innerHTML=sB.innerHTML='';
  bs.forEach(b=>{sA.add(new Option(b,b));sB.add(new Option(b,b));});
  if(bs.length>1)sB.selectedIndex=1;
  document.getElementById('status').textContent=bs.length?'Select browsers and click Compare.':'No extractor data yet — run_mini first.';
}).catch(()=>{});

function setFilter(f,btn){
  curFilter=f;
  document.querySelectorAll('.btns button').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  render();
}
function loadDiff(){
  const a=document.getElementById('selA').value, b=document.getElementById('selB').value;
  if(!a||!b)return;
  document.getElementById('status').textContent='Loading…';
  fetch('/api/extractor/diff?a='+encodeURIComponent(a)+'&b='+encodeURIComponent(b))
    .then(r=>r.json()).then(rows=>{allRows=rows;document.getElementById('tbl').style.display='';render();});
}
function render(){
  const rows=curFilter==='all'?allRows:allRows.filter(r=>r.status===curFilter);
  const bc={same:'bs',diff:'bd','only-a':'ba','only-b':'bb'}, bl={same:'same',diff:'diff','only-a':'only A','only-b':'only B'};
  document.getElementById('tbody').innerHTML=rows.map(r=>\`<tr class="\${r.status}">
    <td class="name">\${e(r.name)}</td><td>\${e(r.type||'')}</td>
    <td>\${e(r.valueA!=null?r.valueA:'—')}</td><td>\${e(r.valueB!=null?r.valueB:'—')}</td>
    <td><span class="badge \${bc[r.status]}">\${bl[r.status]}</span></td></tr>\`).join('');
  const c={same:0,diff:0,'only-a':0,'only-b':0};allRows.forEach(r=>c[r.status]++);
  document.getElementById('status').textContent=
    allRows.length+' total — '+c.same+' same, '+c.diff+' different, '+c['only-a']+' only A, '+c['only-b']+' only B — showing '+rows.length;
}
function e(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
</script>
</body></html>`);
});

app.get('/canirun', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Can I Run — Browser Function Support</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',Tahoma,sans-serif;background:#0d1117;color:#c9d1d9;padding:32px;min-height:100vh}
    h1{font-size:22px;color:#58a6ff;margin-bottom:6px}
    .sub{font-size:13px;color:#8b949e;margin-bottom:22px}
    .search{display:flex;gap:10px;margin-bottom:22px}
    input{background:#161b22;color:#c9d1d9;border:1px solid #30363d;padding:8px 14px;border-radius:6px;font-size:14px;width:420px}
    input:focus{outline:none;border-color:#58a6ff}
    button{background:#1f6feb;color:#fff;border:none;padding:8px 18px;border-radius:6px;cursor:pointer;font-size:14px}
    button:hover{background:#388bfd}
    #status{font-size:13px;color:#8b949e;margin-bottom:14px;min-height:18px}
    .wrap{overflow-x:auto}
    table{border-collapse:collapse;font-size:12px;font-family:monospace;white-space:nowrap}
    th{background:#161b22;color:#8b949e;padding:7px 10px;border-bottom:1px solid #30363d;position:sticky;top:0;font-weight:500;font-family:'Segoe UI',sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:.4px}
    th.bh{max-width:90px;overflow:hidden;text-overflow:ellipsis;font-size:13px;font-weight:700;color:#c9d1d9;writing-mode:vertical-rl;height:120px;vertical-align:bottom;padding-bottom:8px}
    td{padding:5px 10px;border-bottom:1px solid #161b22;text-align:center}
    td.fname{text-align:left;font-size:12px;white-space:nowrap;max-width:340px;overflow:hidden;text-overflow:ellipsis}
    .y{color:#3fb950;font-size:14px}.n{color:#f85149;opacity:.5;font-size:14px}.p{color:#f0883e;font-size:14px}
    .legend{margin-top:14px;font-size:11px;color:#8b949e}
    a{color:#58a6ff;text-decoration:none;font-size:13px}a:hover{text-decoration:underline}
  </style>
</head>
<body>
  <h1>Can I Run</h1>
  <p class="sub"><a href="/">← Dashboard</a> &nbsp;|&nbsp; <a href="/diff">Diff →</a></p>
  <p class="sub">Search for a window function by name to see which browsers support it. Queries only <em>type=function</em> rows from the extractor data.</p>
  <div class="search">
    <input id="q" type="text" placeholder="e.g. requestIdleCallback, fetch, Notification…" onkeydown="if(event.key==='Enter')search()">
    <button onclick="search()">Search</button>
  </div>
  <div id="status">Type a function name and press Search.</div>
  <div class="wrap"><div id="result"></div></div>
<script>
function search(){
  const q=document.getElementById('q').value.trim();
  if(!q)return;
  document.getElementById('status').textContent='Searching…';
  document.getElementById('result').innerHTML='';
  fetch('/api/extractor/functions?q='+encodeURIComponent(q))
    .then(r=>r.json()).then(data=>render(data,q)).catch(err=>{
      document.getElementById('status').textContent='Error: '+err.message;
    });
}
function render({browsers,functions},q){
  if(!functions.length){document.getElementById('status').textContent='No functions matching "'+e(q)+'" found.';return;}
  document.getElementById('status').textContent=functions.length+' function(s) across '+browsers.length+' browser(s).';
  const html='<table><thead><tr><th class="fname">Function</th>'+
    browsers.map(b=>'<th class="bh" title="'+e(b)+'">'+e(short(b))+'</th>').join('')+'</tr></thead><tbody>'+
    functions.map(fn=>'<tr><td class="fname" title="'+e(fn.name)+'">'+e(fn.name)+'</td>'+
      browsers.map(b=>{
        const v=fn.support[b];
        if(v==null)return '<td class="n" title="not found">✗</td>';
        const nat=v.includes('[native code]');
        return '<td class="'+(nat?'y':'p')+'" title="'+e(v)+'">'+(nat?'✓':'~')+'</td>';
      }).join('')+'</tr>').join('')+
    '</tbody></table><p class="legend">✓ native &nbsp; ~ polyfill/non-native &nbsp; ✗ not found in this browser</p>';
  document.getElementById('result').innerHTML=html;
}
function short(s){
  return s.replace('playwright','pl').replace('puppeteer','pp').replace('webdriverio','wdio')
    .replace('selenium','sel').replace('chromium','chrom').replace('firefox-pw','ff-pw')
    .replace('headless','hl').replace('headfull','hf')
    .replace('edge-beta','e-β').replace('edge-dev','e-dev');
}
function e(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
</script>
</body></html>`);
});

// ── Interceptions helpers ─────────────────────────────────────────────────────

/** First non-intercepted, non-Error frame from a stack string. */
function extractCaller(stack) {
  const lines = (stack || '').split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('at ') && !t.includes('intercepted_') && !t.startsWith('at Error')) {
      return t.slice(3);
    }
  }
  return '';
}

/** True when the call was triggered by our own runner API (__setAction etc.). */
function isOwnCall(row) {
  const stack = row.stack || '';
  const args  = row.args_json || '';
  const own   = ['cheq_setAction', 'cheq_getBuffer', 'cheq_restoreInterceptions'];
  return own.some(n => stack.includes(n) || args.includes(n));
}

// ── Interceptions pages ───────────────────────────────────────────────────────

app.get('/interceptions', (_req, res) => {
  const sessions = getInterceptionSessions();
  const rows = sessions.map(s => `
    <tr>
      <td>${s.id}</td>
      <td><span style="color:#58a6ff">${esc(s.framework)}</span></td>
      <td style="font-family:monospace;font-size:11px">${esc(s.browser_label)}</td>
      <td style="font-family:monospace;font-size:11px">${esc(s.started_at)}</td>
      <td>${s.completed_at ? esc(s.completed_at.slice(11,19)) : '<span style="color:#f85149">running</span>'}</td>
      <td style="text-align:right">${s.action_count}</td>
      <td style="text-align:right">${s.call_count}</td>
      <td><a href="/interceptions/${s.id}">/interceptions/${s.id}</a></td>
    </tr>`).join('');

  res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Interceptions — Sessions</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Tahoma,sans-serif;background:#0d1117;color:#c9d1d9;padding:32px;min-height:100vh}
h1{font-size:22px;color:#58a6ff;margin-bottom:6px}
.sub{font-size:13px;color:#8b949e;margin-bottom:24px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:8px 12px;color:#8b949e;font-weight:500;border-bottom:1px solid #21262d;font-size:11px;text-transform:uppercase}
td{padding:8px 12px;border-bottom:1px solid #161b22;vertical-align:middle}
tr:hover td{background:#161b22}
a{color:#58a6ff;text-decoration:none}a:hover{text-decoration:underline}
.empty{color:#6e7681;padding:20px;text-align:center}
</style></head><body>
<h1>Interceptions — Sessions</h1>
<p class="sub"><a href="/">← Dashboard</a></p>
${sessions.length === 0
    ? '<p class="empty">No interception sessions yet. Run <code>node interceptions_runner.js</code> first.</p>'
    : `<table><thead><tr>
        <th>#</th><th>Framework</th><th>Browser</th>
        <th>Started</th><th>Done (UTC)</th><th style="text-align:right">Actions</th>
        <th style="text-align:right">Calls</th><th>Detail</th>
      </tr></thead><tbody>${rows}</tbody></table>`}
</body></html>`);
});

app.get('/interceptions/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).send('Invalid id');
  const session = getInterceptionSession(id);
  if (!session) return res.status(404).send(`Session #${id} not found`);

  const actionFilter = req.query.action || '';
  const fnFilter     = req.query.fn     || '';
  const offset       = Number(req.query.offset) || 0;
  const limit        = 500;

  const actions  = getInterceptionActions(id);
  const topFns   = getTopInterceptedFunctions(id, 30);
  const rows     = getInterceptions(id, { action: actionFilter || undefined, fn: fnFilter || undefined, limit, offset });

  const actionOpts = actions.map(a =>
    `<option value="${esc(a.action)}" ${a.action === actionFilter ? 'selected' : ''}>${esc(a.action)} (${a.cnt})</option>`
  ).join('');

  const topFnRows = topFns.map(f =>
    `<tr><td class="fname">${esc(f.fn_name)}</td><td style="text-align:right;color:#58a6ff">${f.cnt}</td></tr>`
  ).join('');

  // Filter out calls triggered by our own runner API
  const visibleRows = rows.filter(r => !isOwnCall(r));

  const stacksOpen = !!(actionFilter || fnFilter); // expand stacks when filtered

  const dataRows = visibleRows.map(r => {
    const args    = r.args_json ? (() => { try { return JSON.parse(r.args_json); } catch { return [r.args_json]; } })() : [];
    const argsStr = args.length ? args.map(a => `<code class="arg">${esc(String(a))}</code>`).join(' ') : '';
    // Prefer stored caller field; fall back to extracting from stack for old rows
    const caller  = r.caller || extractCaller(r.stack);
    // Stack: skip first "Error\n" line, keep the rest
    const stackStr = (r.stack || '').replace(/^Error\n?/, '').trim();
    const stackHtml = stackStr
      ? `<details class="stk"${stacksOpen ? ' open' : ''}><summary>${stackStr.split('\n').length} frames</summary><pre class="stk-pre">${esc(stackStr)}</pre></details>`
      : '';
    const durStr = r.duration_ms > 0 ? `${r.duration_ms.toFixed(2)}ms` : '';
    const retVal = r.return_val && r.return_val !== 'undefined' && r.return_val !== 'null' ? r.return_val : '';
    const thisVal = r.this_arg && r.this_arg !== '[Window]' && r.this_arg !== 'undefined' ? r.this_arg : '';
    const isCtor = r.is_constructor === 1;
    return `<div class="call">
  <div class="call-head">
    <span class="seq">#${r.seq}</span>
    <span class="act-badge">${esc(r.action)}</span>
    <a class="fn-name" href="/interceptions/${id}?fn=${encodeURIComponent(r.fn_name)}">${esc(r.fn_name)}</a>${isCtor ? ' <span class="ctor-badge">new</span>' : ''}${durStr ? ` <span class="dur">${esc(durStr)}</span>` : ''}
  </div>${thisVal ? `
  <div class="call-row"><span class="lbl">This</span><code class="this-val">${esc(thisVal)}</code></div>` : ''}${caller ? `
  <div class="call-row"><span class="lbl">Caller</span><code class="caller">${esc(caller)}</code></div>` : ''}${argsStr ? `
  <div class="call-row"><span class="lbl">Args</span><span class="args">${argsStr}</span></div>` : ''}${retVal ? `
  <div class="call-row"><span class="lbl">Returns</span><code class="ret-val">${esc(retVal)}</code></div>` : ''}${stackHtml ? `
  <div class="call-row call-row--stack"><span class="lbl">Stack</span>${stackHtml}</div>` : ''}
</div>`;
  }).join('\n');

  const prevOffset = Math.max(0, offset - limit);
  const nextOffset = offset + limit;
  const hasPrev = offset > 0;
  const hasNext = rows.length === limit;

  res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Interceptions #${id}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Tahoma,sans-serif;background:#0d1117;color:#c9d1d9;padding:28px;min-height:100vh}
h1{font-size:20px;color:#58a6ff;margin-bottom:4px}
.meta{font-size:12px;color:#8b949e;margin-bottom:20px}
.layout{display:flex;gap:22px;align-items:flex-start}
.sidebar{min-width:210px;max-width:240px;flex-shrink:0}
.main{flex:1;min-width:0}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:13px;margin-bottom:13px}
.card h2{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#8b949e;margin-bottom:9px}
.fname{font-size:11px;font-family:monospace;color:#c9d1d9;padding:3px 0;border-bottom:1px solid #21262d}
.fname:last-child{border:none}
.fname span{float:right;color:#58a6ff}
.filters{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;align-items:flex-end}
select,input[type=text]{background:#161b22;color:#c9d1d9;border:1px solid #30363d;padding:6px 10px;border-radius:6px;font-size:12px}
button{background:#1f6feb;color:#fff;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px}
button:hover{background:#388bfd}
/* Call cards */
.call{background:#161b22;border:1px solid #30363d;border-radius:7px;padding:11px 14px;margin-bottom:9px;font-size:12px}
.call-head{display:flex;align-items:baseline;gap:8px;margin-bottom:6px;flex-wrap:wrap}
.seq{font-size:10px;color:#6e7681;font-family:monospace;min-width:36px}
.act-badge{background:#f0883e22;color:#f0883e;border:1px solid #f0883e44;border-radius:4px;padding:1px 7px;font-size:11px;font-family:monospace;white-space:nowrap}
.fn-name{color:#79c0ff;font-family:monospace;font-size:13px;font-weight:600;word-break:break-all;text-decoration:none}
.fn-name:hover{text-decoration:underline;color:#a5d6ff}
.call-row{display:flex;gap:8px;align-items:baseline;margin-top:4px;flex-wrap:wrap}
.lbl{font-size:10px;color:#6e7681;text-transform:uppercase;letter-spacing:.4px;min-width:42px;flex-shrink:0;padding-top:2px}
.caller{font-family:monospace;font-size:11px;color:#3fb950;word-break:break-all}
.args{display:flex;gap:4px;flex-wrap:wrap}
code.arg{background:#1a2233;color:#e6c07b;padding:1px 6px;border-radius:3px;font-family:monospace;font-size:11px;word-break:break-all}
.this-val{font-family:monospace;font-size:11px;color:#d2a8ff;word-break:break-all}
.ret-val{font-family:monospace;font-size:11px;color:#a5d6ff;word-break:break-all}
.ctor-badge{background:#1f6feb33;color:#58a6ff;border:1px solid #1f6feb55;border-radius:4px;padding:1px 6px;font-size:10px}
.dur{font-size:10px;color:#6e7681;font-family:monospace}
/* Stack */
.call-row--stack{align-items:flex-start}
details.stk summary{cursor:pointer;font-size:10px;color:#8b949e;padding:2px 0;user-select:none}
details.stk summary:hover{color:#c9d1d9}
pre.stk-pre{font-family:monospace;font-size:10px;color:#8b949e;white-space:pre-wrap;word-break:break-all;margin-top:5px;padding:8px 10px;background:#0d1117;border:1px solid #21262d;border-radius:4px;line-height:1.5}
a{color:#58a6ff;text-decoration:none}a:hover{text-decoration:underline}
.pagination{margin-top:14px;display:flex;gap:10px}
.pagination a{background:#21262d;border:1px solid #30363d;padding:5px 12px;border-radius:6px;font-size:12px}
.empty{color:#6e7681;padding:16px;font-size:13px}
.count{font-size:11px;color:#6e7681;margin-bottom:10px}
</style></head><body>
<h1>Interceptions — Session #${id}</h1>
<p class="meta">
  <a href="/interceptions">← Sessions</a> &nbsp;|&nbsp;
  <strong style="color:#58a6ff">${esc(session.framework)}</strong> &nbsp;
  <code>${esc(session.browser_label)}</code> &nbsp;|&nbsp;
  ${esc(session.started_at)} &nbsp;|&nbsp;
  ${session.action_count} actions &nbsp; ${session.call_count} calls
</p>
<div class="layout">
  <div class="sidebar">
    <div class="card">
      <h2>Top Functions</h2>
      ${topFns.map(f => `<div class="fname"><a href="/interceptions/${id}?fn=${encodeURIComponent(f.fn_name)}" style="color:inherit;text-decoration:none" title="Filter by ${esc(f.fn_name)}">${esc(f.fn_name)}</a><span>${f.cnt}</span></div>`).join('')}
    </div>
  </div>
  <div class="main">
    <form method="GET" action="/interceptions/${id}">
      <div class="filters">
        <div>
          <div style="font-size:11px;color:#8b949e;margin-bottom:4px">Filter by Action</div>
          <select name="action"><option value="">All actions</option>${actionOpts}</select>
        </div>
        <div>
          <div style="font-size:11px;color:#8b949e;margin-bottom:4px">Filter by Function</div>
          <input name="fn" type="text" value="${esc(fnFilter)}" placeholder="e.g. addEventListener">
        </div>
        <button type="submit">Apply</button>
        ${actionFilter || fnFilter ? `<a href="/interceptions/${id}" style="color:#8b949e;font-size:12px">Clear</a>` : ''}
      </div>
    </form>
    <p class="count">${visibleRows.length} call${visibleRows.length === 1 ? '' : 's'}${offset > 0 ? ` (offset ${offset})` : ''}${stacksOpen ? ' — stacks expanded' : ' — click ▸ to expand stack'}</p>
    ${dataRows || '<p class="empty">No results.</p>'}
    <div class="pagination">
      ${hasPrev ? `<a href="/interceptions/${id}?action=${esc(actionFilter)}&fn=${esc(fnFilter)}&offset=${prevOffset}">← Previous ${limit}</a>` : ''}
      ${hasNext ? `<a href="/interceptions/${id}?action=${esc(actionFilter)}&fn=${esc(fnFilter)}&offset=${nextOffset}">Next ${limit} →</a>` : ''}
    </div>
  </div>
</div>
</body></html>`);
});

// ── start ─────────────────────────────────────────────────────────────────────

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Results server listening at http://localhost:${PORT}`);
  console.log(`  /              — dashboard`);
  console.log(`  /mini          — latest mini results`);
  console.log(`  /full          — latest full results`);
  console.log(`  /run/N         — specific historical run`);
  console.log(`  /interceptions — interceptions sessions`);
});

server.on('error', (err) => {
  console.error('Server error:', err);
  process.exit(1);
});
