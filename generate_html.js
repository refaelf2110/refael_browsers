'use strict';

const TEST_URL = 'https://obs.4.dev.cheqzone.com/tests/collector.html';
const EXCLUDED_REASONS = new Set(['100', '112', '214']);

/**
 * Generate the detection results HTML page.
 *
 * @param {Array}  results     - Array of result objects:
 *                               { framework, label, major, mode, positiveReasons, allReasons, error }
 * @param {string} elapsed     - Human-readable duration string, e.g. "8m 28s"
 * @param {string} runLabel    - "Mini" or "Full"
 * @param {string} receivedAt  - ISO timestamp of when results were stored (shown in footer)
 * @returns {string}           - Complete HTML document
 */
function generateHTML(results, elapsed, runLabel, receivedAt) {
  const total   = results.length;
  const nDetect = results.filter(r => !r.error && r.positiveReasons.length > 0).length;
  const nClean  = results.filter(r => !r.error && r.positiveReasons.length === 0).length;
  const nError  = results.filter(r =>  r.error).length;

  const allUniqueReasons = [...new Set(results.flatMap(r => r.allReasons || []))]
    .sort((a, b) => {
      const an = Number(a), bn = Number(b);
      return (!isNaN(an) && !isNaN(bn)) ? an - bn : a.localeCompare(b);
    });

  function logoUrl(label) {
    const base = 'https://cdn.jsdelivr.net/gh/alrra/browser-logos/src';
    const l = (label || '').toLowerCase();
    if (l === 'chrome')        return `${base}/chrome/chrome_32x32.png`;
    if (l === 'chromium')      return `${base}/chromium/chromium_32x32.png`;
    if (l === 'firefox' || l === 'firefox-pw') return `${base}/firefox/firefox_32x32.png`;
    if (l === 'edge')          return `${base}/edge/edge_32x32.png`;
    if (l === 'edge-beta')     return `${base}/edge-beta/edge-beta_32x32.png`;
    if (l === 'edge-dev')      return `${base}/edge-dev/edge-dev_32x32.png`;
    if (l === 'edge-canary')   return `${base}/edge-canary/edge-canary_32x32.png`;
    if (l === 'edge-nightly')  return `${base}/edge-nightly/edge-nightly_32x32.png`;
    return '';
  }

  const esc = s => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const cls        = r => r.error ? 'error' : r.positiveReasons.length > 0 ? 'green' : 'red';
  const icon       = r => r.error ? '⚠' : r.positiveReasons.length > 0 ? '✓' : '✗';
  const detailText = r => {
    if (r.error) { const s = r.error.length > 45 ? r.error.slice(0, 42) + '…' : r.error; return esc(s); }
    if (r.positiveReasons.length === 0) return 'Not detected';
    const s = r.positiveReasons.join(', ');
    return esc(s.length > 45 ? s.slice(0, 42) + '…' : s);
  };
  const titleAttr = r => {
    if (r.error) return esc(r.error);
    if (r.positiveReasons.length === 0) return 'Not detected';
    return esc(r.positiveReasons.join(', '));
  };

  const sortPaired = rows => [...rows].sort((a, b) => {
    const am = Number(a.major), bm = Number(b.major);
    if (!isNaN(am) && !isNaN(bm) && am !== bm) return bm - am;
    if (isNaN(am) && !isNaN(bm)) return 1;
    if (!isNaN(am) && isNaN(bm)) return -1;
    if (a.label !== b.label) return a.label.localeCompare(b.label);
    if (a.mode !== b.mode) return a.mode === 'headfull' ? -1 : 1;
    return 0;
  });

  const renderSection = (fw, title) => {
    const rows = sortPaired(results.map((r, i) => ({ ...r, i })).filter(r => r.framework === fw));
    if (!rows.length) return '';
    const cells = rows.map(r => {
      const url = logoUrl(r.label);
      const modeClass = r.mode === 'headless' ? 'mode-headless' : 'mode-headfull';
      return `
        <div class="cell ${cls(r)}" id="c${r.i}" title="${titleAttr(r)}">
          <div class="icon">${icon(r)}</div>
          <div class="browser">${esc(r.label)} ${esc(r.major)}</div>
          <div class="mode-row">${url ? `<img class="logo" src="${url}" alt="" onerror="this.style.display='none'">` : ''}<span class="mode ${modeClass}">${r.mode}</span></div>
          <div class="detail">${detailText(r)}</div>
        </div>`;
    }).join('');
    return `<section><h2>${title}</h2><div class="grid">${cells}</div></section>`;
  };

  const exclusionPills = allUniqueReasons.map(r => {
    const checked = EXCLUDED_REASONS.has(r) ? ' checked' : '';
    return `<label class="reason-pill"><input type="checkbox" class="excl-cb" data-reason="${esc(r)}"${checked}> ${esc(r)}</label>`;
  }).join('');

  const resultsJson = JSON.stringify(results.map((r, i) => ({
    i,
    framework:  r.framework,
    label:      r.label,
    major:      r.major,
    mode:       r.mode,
    allReasons: r.allReasons || [],
    error:      r.error || null,
  })));

  const receivedLine = receivedAt
    ? ` · Results received ${new Date(receivedAt).toISOString()}`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Browser Detection Matrix${runLabel ? ' — ' + runLabel : ''}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',Tahoma,sans-serif;background:#0d1117;color:#c9d1d9;padding:28px;min-height:100vh}
    h1{font-size:26px;color:#58a6ff;margin-bottom:6px}
    .run-label{display:inline-block;font-size:12px;background:#1f2937;color:#58a6ff;border:1px solid #30363d;
      border-radius:4px;padding:2px 8px;margin-left:10px;vertical-align:middle}
    .subtitle{font-size:13px;color:#8b949e;margin-bottom:16px;line-height:1.6}
    .technique{font-size:12px;color:#8b949e;background:#161b22;border:1px solid #30363d;
      border-radius:6px;padding:12px 16px;margin-bottom:24px;line-height:2}
    .technique strong{color:#c9d1d9}
    code{background:#1f2937;padding:1px 5px;border-radius:3px;font-family:monospace;font-size:11px}
    .stats{display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap}
    .stat{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px 20px;text-align:center;min-width:90px}
    .stat .num{font-size:30px;font-weight:700;line-height:1}
    .stat .lbl{font-size:11px;color:#8b949e;margin-top:4px}
    .total .num{color:#58a6ff}.s-green .num{color:#3fb950}.s-red .num{color:#f85149}.s-gray .num{color:#6e7681}
    .legend{display:flex;gap:20px;margin-bottom:16px;font-size:12px;flex-wrap:wrap}
    .legend-item{display:flex;align-items:center;gap:6px;color:#8b949e}
    .dot{width:12px;height:12px;border-radius:3px;flex-shrink:0}
    .dot.green{background:#238636;border:1px solid #3fb950}
    .dot.red{background:#8b1a1a;border:1px solid #f85149}
    .dot.gray{background:#21262d;border:1px solid #6e7681}
    .excl-panel{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px 18px;margin-bottom:28px}
    .excl-panel h3{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#8b949e;margin-bottom:10px}
    .excl-hint{font-weight:400;color:#6e7681;font-size:10px;text-transform:none;letter-spacing:0;margin-left:6px}
    .excl-pills{display:flex;flex-wrap:wrap;gap:6px}
    .reason-pill{display:inline-flex;align-items:center;gap:4px;background:#0d1117;border:1px solid #30363d;
      border-radius:20px;padding:3px 10px;font-size:11px;color:#c9d1d9;cursor:pointer;user-select:none;
      transition:border-color .15s,background .15s}
    .reason-pill:hover{border-color:#58a6ff}
    .reason-pill input{accent-color:#58a6ff;cursor:pointer}
    section{margin-bottom:32px}
    h2{font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;
       color:#8b949e;margin-bottom:12px;padding-bottom:6px;border-bottom:1px solid #21262d}
    .grid{display:flex;flex-wrap:wrap;gap:8px}
    .cell{width:112px;border-radius:8px;padding:8px 6px;display:flex;flex-direction:column;
          align-items:center;gap:3px;cursor:default;text-align:center;
          transition:transform .15s,box-shadow .15s,background .2s,border-color .2s}
    .cell:hover{transform:translateY(-2px);box-shadow:0 6px 16px rgba(0,0,0,.5)}
    .cell.green{background:#0d2818;border:1px solid #238636}
    .cell.red{background:#2d1117;border:1px solid #8b1a1a}
    .cell.error{background:#161b22;border:1px solid #30363d}
    .mode-row{display:flex;align-items:center;justify-content:center;gap:4px}
    .logo{width:14px;height:14px;flex-shrink:0;vertical-align:middle}
    .icon{font-size:20px}
    .green .icon{color:#3fb950}.red .icon{color:#f85149}.error .icon{color:#6e7681}
    .browser{font-size:11px;font-weight:600;color:#c9d1d9;word-break:break-all}
    .mode{font-size:9px;text-transform:uppercase;letter-spacing:.5px;border-radius:3px;padding:2px 5px}
    .mode-headless{color:#3d4450;background:#0a0c0f;border:1px solid #1c2028}
    .mode-headfull{color:#b0bec8;background:#222d3a;border:1px solid #3a4d60}
    .detail{font-size:9px;font-style:italic;margin-top:2px;word-break:break-word}
    .green .detail{color:#3fb950}.red .detail{color:#f85149}.error .detail{color:#6e7681}
    .ts{margin-top:32px;font-size:11px;color:#6e7681}
  </style>
</head>
<body>
  <h1>Browser Automation Detection Matrix${runLabel ? `<span class="run-label">${runLabel}</span>` : ''}</h1>
  <p class="subtitle">
    Each browser navigated to <code>${TEST_URL}</code><br>
    Waited for the sync section, then extracted positive values from <code>reasonList</code> (sorted low→high).<br>
    Green = detected &nbsp;·&nbsp; Red = evaded &nbsp;·&nbsp; Gray = error
  </p>
  <div class="technique">
    <strong>Detection target:</strong> <code>${TEST_URL}</code><br>
    Element polled: <code>document.getElementById('sync-data')</code><br>
    Field extracted: <code>reasonList[]</code> — positive entries sorted ascending<br>
    CLEAN browsers are verified to have received the sync JSON — if not, marked as error
  </div>
  <div class="stats">
    <div class="stat total"><div class="num" id="n-total">${total}</div><div class="lbl">Total</div></div>
    <div class="stat s-green"><div class="num" id="n-detect">${nDetect}</div><div class="lbl">✓ Detected</div></div>
    <div class="stat s-red"><div class="num" id="n-clean">${nClean}</div><div class="lbl">✗ Evaded</div></div>
    <div class="stat s-gray"><div class="num" id="n-error">${nError}</div><div class="lbl">⚠ Error</div></div>
  </div>
  <div class="legend">
    <div class="legend-item"><div class="dot green"></div>Detected — has positive reasonList entries</div>
    <div class="legend-item"><div class="dot red"></div>Evaded detection — no positive reasons</div>
    <div class="legend-item"><div class="dot gray"></div>Error / sync not received</div>
  </div>
  <div class="excl-panel">
    <h3>Excluded Reason Codes <span class="excl-hint">(checked = excluded from detection count)</span></h3>
    <div class="excl-pills">${exclusionPills}</div>
  </div>
  ${renderSection('playwright',  'Playwright')}
  ${renderSection('puppeteer',   'Puppeteer')}
  ${renderSection('selenium',    'Selenium')}
  ${renderSection('webdriverio', 'WebdriverIO')}
  ${renderSection('taiko',       'Taiko')}
  ${renderSection('cypress',     'Cypress')}
  ${renderSection('testcafe',    'TestCafe')}
  <p class="ts">Generated ${new Date().toISOString()} · ${total} combinations tested · Took ${elapsed}${receivedLine}</p>
  <script>
    const RESULTS = ${resultsJson};
    function getExcl() {
      return new Set([...document.querySelectorAll('.excl-cb:checked')].map(c => c.dataset.reason));
    }
    function getPos(r, excl) {
      return r.error ? [] : r.allReasons.filter(x => !excl.has(x));
    }
    function detTxt(r, pos) {
      if (r.error) { const s = r.error; return s.length > 45 ? s.slice(0, 42) + '\u2026' : s; }
      if (!pos.length) return 'Not detected';
      const s = pos.join(', ');
      return s.length > 45 ? s.slice(0, 42) + '\u2026' : s;
    }
    function refresh() {
      const excl = getExcl();
      let nD = 0, nC = 0, nE = 0;
      RESULTS.forEach(r => { if (r.error) nE++; else if (getPos(r, excl).length) nD++; else nC++; });
      document.getElementById('n-detect').textContent = nD;
      document.getElementById('n-clean').textContent  = nC;
      document.getElementById('n-error').textContent  = nE;
      RESULTS.forEach(r => {
        const cell = document.getElementById('c' + r.i);
        if (!cell) return;
        const pos = getPos(r, excl);
        cell.className = 'cell ' + (r.error ? 'error' : pos.length ? 'green' : 'red');
        cell.querySelector('.icon').textContent   = r.error ? '\u26a0' : pos.length ? '\u2713' : '\u2717';
        cell.querySelector('.detail').textContent = detTxt(r, pos);
        cell.title = r.error || (pos.length ? pos.join(', ') : 'Not detected');
      });
    }
    document.querySelectorAll('.excl-cb').forEach(cb => cb.addEventListener('change', refresh));
  </script>
</body>
</html>`;
}

module.exports = { generateHTML, EXCLUDED_REASONS, TEST_URL };
