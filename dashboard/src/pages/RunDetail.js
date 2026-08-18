import React, { useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getRun } from '../api';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';

const DEFAULT_EXCLUDED = new Set(['100', '112', '214']);

const FRAMEWORKS = [
  ['playwright',  'Playwright'],
  ['puppeteer',   'Puppeteer'],
  ['selenium',    'Selenium'],
  ['webdriverio', 'WebdriverIO'],
  ['taiko',       'Taiko'],
  ['cypress',     'Cypress'],
  ['testcafe',    'TestCafe'],
];

function logoUrl(label) {
  const base = 'https://cdn.jsdelivr.net/gh/alrra/browser-logos/src';
  const l = (label || '').toLowerCase();
  if (l === 'chrome')    return `${base}/chrome/chrome_32x32.png`;
  if (l === 'chromium')  return `${base}/chromium/chromium_32x32.png`;
  if (l === 'firefox' || l === 'firefox-pw') return `${base}/firefox/firefox_32x32.png`;
  if (l === 'edge')      return `${base}/edge/edge_32x32.png`;
  if (l === 'edge-beta') return `${base}/edge-beta/edge-beta_32x32.png`;
  if (l === 'edge-dev')  return `${base}/edge-dev/edge-dev_32x32.png`;
  if (l === 'edge-canary')  return `${base}/edge-canary/edge-canary_32x32.png`;
  if (l === 'edge-nightly') return `${base}/edge-nightly/edge-nightly_32x32.png`;
  return '';
}

function sortRows(rows) {
  return [...rows].sort((a, b) => {
    const am = Number(a.major), bm = Number(b.major);
    if (!isNaN(am) && !isNaN(bm) && am !== bm) return bm - am;
    if (isNaN(am) && !isNaN(bm)) return 1;
    if (!isNaN(am) && isNaN(bm)) return -1;
    if (a.label !== b.label) return a.label.localeCompare(b.label);
    if (a.mode !== b.mode) return a.mode === 'headfull' ? -1 : 1;
    return 0;
  });
}

function getPositiveReasons(r, excludedSet) {
  if (r.error) return [];
  return (r.allReasons || []).filter(x => !excludedSet.has(x));
}

function cellClass(r, posReasons) {
  if (r.error) return 'error';
  return posReasons.length > 0 ? 'green' : 'red';
}

function cellIcon(r, posReasons) {
  if (r.error) return '⚠';
  return posReasons.length > 0 ? '✓' : '✗';
}

function detailText(r, posReasons) {
  if (r.error) {
    const s = r.error;
    return s.length > 45 ? s.slice(0, 42) + '…' : s;
  }
  if (posReasons.length === 0) return 'Not detected';
  const s = posReasons.join(', ');
  return s.length > 45 ? s.slice(0, 42) + '…' : s;
}

function titleText(r, posReasons) {
  if (r.error) return r.error;
  if (posReasons.length === 0) return 'Not detected';
  return posReasons.join(', ');
}

const cellColors = {
  green: { background: '#0d2818', border: '1px solid #238636' },
  red:   { background: '#2d1117', border: '1px solid #8b1a1a' },
  error: { background: '#161b22', border: '1px solid #30363d' },
};
const iconColors = { green: '#3fb950', red: '#f85149', error: '#6e7681' };
const detailColors = { green: '#3fb950', red: '#f85149', error: '#6e7681' };

export default function RunDetail() {
  const { id } = useParams();
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);
  const [excludedSet, setExcludedSet] = useState(new Set(DEFAULT_EXCLUDED));

  useEffect(() => {
    getRun(id)
      .then(setRun)
      .catch(setError);
  }, [id]);

  const allUniqueReasons = useMemo(() => {
    if (!run) return [];
    const s = new Set((run.results || []).flatMap(r => r.allReasons || []));
    return [...s].sort((a, b) => {
      const an = Number(a), bn = Number(b);
      return (!isNaN(an) && !isNaN(bn)) ? an - bn : a.localeCompare(b);
    });
  }, [run]);

  const stats = useMemo(() => {
    if (!run) return { total: 0, detected: 0, evaded: 0, errors: 0 };
    const results = run.results || [];
    const total = results.length;
    let detected = 0, evaded = 0, errors = 0;
    for (const r of results) {
      if (r.error) { errors++; continue; }
      const pos = getPositiveReasons(r, excludedSet);
      if (pos.length > 0) detected++; else evaded++;
    }
    return { total, detected, evaded, errors };
  }, [run, excludedSet]);

  const toggleReason = (reason) => {
    setExcludedSet(prev => {
      const next = new Set(prev);
      if (next.has(reason)) next.delete(reason); else next.add(reason);
      return next;
    });
  };

  if (error) return <ErrorMessage error={error} />;
  if (!run) return <LoadingSpinner />;

  const runLabel = run.run_type === 'mini' ? 'Mini' : 'Full';

  return (
    <div style={{ padding: '28px', fontFamily: "'Segoe UI', Tahoma, sans-serif" }}>
      <h1 style={{ fontSize: '26px', color: '#58a6ff', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        Browser Automation Detection Matrix
        <span style={{ fontSize: '12px', background: '#1f2937', color: '#58a6ff', border: '1px solid #30363d', borderRadius: '4px', padding: '2px 8px' }}>
          {runLabel} #{run.id}
        </span>
      </h1>
      <p style={{ fontSize: '13px', color: '#8b949e', marginBottom: '20px' }}>
        <Link to="/">← Dashboard</Link>
        {' '}&nbsp;·&nbsp; Completed {run.completed_at} &nbsp;·&nbsp; Took {run.elapsed}
      </p>

      {/* Stats */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
        {[
          { label: 'Total', num: stats.total, color: '#58a6ff' },
          { label: '✓ Detected', num: stats.detected, color: '#3fb950' },
          { label: '✗ Evaded', num: stats.evaded, color: '#f85149' },
          { label: '⚠ Error', num: stats.errors, color: '#6e7681' },
        ].map(s => (
          <div key={s.label} style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: '8px', padding: '12px 20px', textAlign: 'center', minWidth: '90px' }}>
            <div style={{ fontSize: '30px', fontWeight: 700, lineHeight: 1, color: s.color }}>{s.num}</div>
            <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '4px' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '20px', marginBottom: '16px', fontSize: '12px', flexWrap: 'wrap' }}>
        {[
          { cls: 'green', label: 'Detected — has positive reasonList entries', bg: '#238636', border: '#3fb950' },
          { cls: 'red',   label: 'Evaded detection — no positive reasons', bg: '#8b1a1a', border: '#f85149' },
          { cls: 'gray',  label: 'Error / sync not received', bg: '#21262d', border: '#6e7681' },
        ].map(l => (
          <div key={l.cls} style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#8b949e' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '3px', flexShrink: 0, background: l.bg, border: `1px solid ${l.border}` }} />
            {l.label}
          </div>
        ))}
      </div>

      {/* Exclusion panel */}
      <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: '8px', padding: '14px 18px', marginBottom: '28px' }}>
        <h3 style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#8b949e', marginBottom: '10px' }}>
          Excluded Reason Codes{' '}
          <span style={{ fontWeight: 400, color: '#6e7681', fontSize: '10px', textTransform: 'none', letterSpacing: 0, marginLeft: '6px' }}>
            (checked = excluded from detection count)
          </span>
        </h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {allUniqueReasons.map(reason => (
            <label
              key={reason}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '4px',
                background: '#0d1117', border: '1px solid #30363d', borderRadius: '20px',
                padding: '3px 10px', fontSize: '11px', color: '#c9d1d9',
                cursor: 'pointer', userSelect: 'none',
              }}
            >
              <input
                type="checkbox"
                checked={excludedSet.has(reason)}
                onChange={() => toggleReason(reason)}
                style={{ accentColor: '#58a6ff', cursor: 'pointer' }}
              />
              {reason}
            </label>
          ))}
        </div>
      </div>

      {/* Framework sections */}
      {FRAMEWORKS.map(([fw, title]) => {
        const rows = sortRows((run.results || []).filter(r => r.framework === fw));
        if (!rows.length) return null;
        return (
          <section key={fw} style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '13px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#8b949e', marginBottom: '12px', paddingBottom: '6px', borderBottom: '1px solid #21262d' }}>
              {title}
            </h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {rows.map((r, i) => {
                const pos = getPositiveReasons(r, excludedSet);
                const cls = cellClass(r, pos);
                const url = logoUrl(r.label);
                return (
                  <div
                    key={i}
                    title={titleText(r, pos)}
                    style={{
                      width: '112px', borderRadius: '8px', padding: '8px 6px',
                      display: 'flex', flexDirection: 'column', alignItems: 'center',
                      gap: '3px', cursor: 'default', textAlign: 'center',
                      transition: 'transform 0.15s, box-shadow 0.15s',
                      ...cellColors[cls],
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.5)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.transform = '';
                      e.currentTarget.style.boxShadow = '';
                    }}
                  >
                    <div style={{ fontSize: '20px', color: iconColors[cls] }}>{cellIcon(r, pos)}</div>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: '#c9d1d9', wordBreak: 'break-all' }}>
                      {r.label} {r.major}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                      {url && (
                        <img
                          src={url}
                          alt=""
                          width={14}
                          height={14}
                          style={{ flexShrink: 0, verticalAlign: 'middle' }}
                          onError={e => { e.currentTarget.style.display = 'none'; }}
                        />
                      )}
                      <span style={{
                        fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.5px',
                        borderRadius: '3px', padding: '2px 5px',
                        ...(r.mode === 'headless'
                          ? { color: '#3d4450', background: '#0a0c0f', border: '1px solid #1c2028' }
                          : { color: '#b0bec8', background: '#222d3a', border: '1px solid #3a4d60' }),
                      }}>
                        {r.mode}
                      </span>
                    </div>
                    <div style={{ fontSize: '9px', fontStyle: 'italic', marginTop: '2px', wordBreak: 'break-word', color: detailColors[cls] }}>
                      {detailText(r, pos)}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      <p style={{ marginTop: '32px', fontSize: '11px', color: '#6e7681' }}>
        {(run.results || []).length} combinations tested · Took {run.elapsed} · Results received {run.completed_at}
      </p>
    </div>
  );
}
