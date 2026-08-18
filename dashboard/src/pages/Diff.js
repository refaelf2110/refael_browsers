import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getExtractorBrowsers, getExtractorDiff } from '../api';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';

const FILTERS = [
  { key: 'all',    label: 'All' },
  { key: 'diff',   label: 'Differences' },
  { key: 'only-a', label: 'Only A' },
  { key: 'only-b', label: 'Only B' },
  { key: 'same',   label: 'Same' },
];

const statusBadge = {
  same:    { background: '#1f6feb22', color: '#58a6ff', label: 'same' },
  diff:    { background: '#db613022', color: '#f0883e', label: 'diff' },
  'only-a':{ background: '#2ea04322', color: '#3fb950', label: 'only A' },
  'only-b':{ background: '#1f6feb22', color: '#58a6ff', label: 'only B' },
};

const thStyle = {
  position: 'sticky', top: 0, background: '#161b22', color: '#8b949e',
  padding: '7px 10px', textAlign: 'left', borderBottom: '1px solid #30363d',
  fontWeight: 500, fontFamily: "'Segoe UI', sans-serif", fontSize: '11px',
  textTransform: 'uppercase', letterSpacing: '0.5px',
};

const tdStyle = {
  padding: '5px 10px', borderBottom: '1px solid #0d1117',
  verticalAlign: 'top', wordBreak: 'break-all', maxWidth: '380px',
  fontFamily: 'monospace', fontSize: '12px',
};

const nameColors = {
  diff:    '#f0883e',
  'only-a':'#3fb950',
  'only-b':'#58a6ff',
  same:    '#c9d1d9',
};

export default function Diff() {
  const [browsers, setBrowsers] = useState([]);
  const [browsersError, setBrowsersError] = useState(null);
  const [selA, setSelA] = useState('');
  const [selB, setSelB] = useState('');
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [diffError, setDiffError] = useState(null);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    getExtractorBrowsers()
      .then(bs => {
        setBrowsers(bs);
        if (bs.length > 0) setSelA(bs[0]);
        if (bs.length > 1) setSelB(bs[1]);
      })
      .catch(setBrowsersError);
  }, []);

  const handleCompare = () => {
    if (!selA || !selB) return;
    setLoading(true);
    setDiffError(null);
    setRows(null);
    getExtractorDiff(selA, selB)
      .then(data => { setRows(data); setLoading(false); })
      .catch(err => { setDiffError(err); setLoading(false); });
  };

  const counts = rows ? rows.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {}) : {};

  const visibleRows = rows
    ? (filter === 'all' ? rows : rows.filter(r => r.status === filter))
    : [];

  return (
    <div style={{ padding: '32px 28px' }}>
      <h1 style={{ fontSize: '22px', color: '#58a6ff', marginBottom: '20px' }}>Browser Property Diff</h1>
      <p style={{ fontSize: '13px', color: '#8b949e', marginBottom: '20px' }}>
        <Link to="/">← Dashboard</Link> &nbsp;|&nbsp; <Link to="/canirun">Can I Run →</Link>
      </p>

      {browsersError && <ErrorMessage error={browsersError} />}

      <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '18px' }}>
        <div>
          <label style={{ fontSize: '12px', color: '#8b949e', display: 'block', marginBottom: '4px' }}>Browser A</label>
          <select
            value={selA}
            onChange={e => setSelA(e.target.value)}
            style={{ background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d', padding: '7px 12px', borderRadius: '6px', fontSize: '13px', minWidth: '260px' }}
          >
            {browsers.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: '12px', color: '#8b949e', display: 'block', marginBottom: '4px' }}>Browser B</label>
          <select
            value={selB}
            onChange={e => setSelB(e.target.value)}
            style={{ background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d', padding: '7px 12px', borderRadius: '6px', fontSize: '13px', minWidth: '260px' }}
          >
            {browsers.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <button
          onClick={handleCompare}
          disabled={loading || !selA || !selB}
          style={{ background: '#1f6feb', borderColor: '#1f6feb', color: '#fff', border: '1px solid', padding: '7px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
        >
          Compare
        </button>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                background: filter === f.key ? '#1f6feb' : '#21262d',
                border: `1px solid ${filter === f.key ? '#1f6feb' : '#30363d'}`,
                color: filter === f.key ? '#fff' : '#c9d1d9',
                padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <LoadingSpinner message="Comparing…" />}
      {diffError && <ErrorMessage error={diffError} />}

      {rows && (
        <p style={{ fontSize: '13px', color: '#8b949e', marginBottom: '14px' }}>
          {rows.length} total — {counts.same || 0} same, {counts.diff || 0} different,{' '}
          {counts['only-a'] || 0} only A, {counts['only-b'] || 0} only B — showing {visibleRows.length}
        </p>
      )}

      {rows && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'monospace', fontSize: '12px' }}>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Value A</th>
              <th style={thStyle}>Value B</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r, i) => {
              const badge = statusBadge[r.status] || {};
              const opacity = r.status === 'same' ? 0.35 : 1;
              return (
                <tr key={i} style={{ opacity }}>
                  <td style={{ ...tdStyle, color: nameColors[r.status] || '#c9d1d9' }}>{r.name}</td>
                  <td style={tdStyle}>{r.type || ''}</td>
                  <td style={tdStyle}>{r.valueA != null ? String(r.valueA) : '—'}</td>
                  <td style={tdStyle}>{r.valueB != null ? String(r.valueB) : '—'}</td>
                  <td style={tdStyle}>
                    <span style={{ display: 'inline-block', padding: '1px 7px', borderRadius: '3px', fontSize: '10px', fontFamily: "'Segoe UI', sans-serif", background: badge.background, color: badge.color }}>
                      {badge.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {!rows && !loading && !diffError && (
        <p style={{ color: '#8b949e', fontSize: '13px' }}>
          {browsers.length ? 'Select two browsers and click Compare.' : 'No extractor data yet.'}
        </p>
      )}
    </div>
  );
}
