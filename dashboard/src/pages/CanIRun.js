import React, { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { getExtractorFunctions } from '../api';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';

function shortBrowserLabel(s) {
  return s
    .replace('playwright', 'pl')
    .replace('puppeteer', 'pp')
    .replace('webdriverio', 'wdio')
    .replace('selenium', 'sel')
    .replace('chromium', 'chrom')
    .replace('firefox-pw', 'ff-pw')
    .replace('headless', 'hl')
    .replace('headfull', 'hf')
    .replace('edge-beta', 'e-β')
    .replace('edge-dev', 'e-dev');
}

const thBase = {
  background: '#161b22', color: '#8b949e', padding: '7px 10px',
  borderBottom: '1px solid #30363d', position: 'sticky', top: 0,
  fontWeight: 500, fontFamily: "'Segoe UI', sans-serif",
  fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.4px',
};

const thBrowser = {
  ...thBase,
  maxWidth: '90px', overflow: 'hidden', textOverflow: 'ellipsis',
  fontSize: '13px', fontWeight: 700, color: '#c9d1d9',
  writingMode: 'vertical-rl', height: '120px', verticalAlign: 'bottom',
  paddingBottom: '8px',
};

export default function CanIRun() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const handleSearch = () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setResult(null);
    getExtractorFunctions(q)
      .then(data => { setResult(data); setLoading(false); })
      .catch(err => { setError(err); setLoading(false); });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSearch();
  };

  const { browsers = [], functions = [] } = result || {};

  return (
    <div style={{ padding: '32px 28px' }}>
      <h1 style={{ fontSize: '22px', color: '#58a6ff', marginBottom: '6px' }}>Can I Run</h1>
      <p style={{ fontSize: '13px', color: '#8b949e', marginBottom: '14px' }}>
        <Link to="/">← Dashboard</Link> &nbsp;|&nbsp; <Link to="/diff">Diff →</Link>
      </p>
      <p style={{ fontSize: '13px', color: '#8b949e', marginBottom: '22px' }}>
        Search for a window function by name to see which browsers support it.
      </p>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '22px' }}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. requestIdleCallback, fetch, Notification…"
          style={{
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            padding: '8px 14px', borderRadius: '6px', fontSize: '14px', width: '420px',
            outline: 'none',
          }}
          onFocus={e => { e.target.style.borderColor = '#58a6ff'; }}
          onBlur={e => { e.target.style.borderColor = '#30363d'; }}
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          style={{
            background: '#1f6feb', color: '#fff', border: 'none',
            padding: '8px 18px', borderRadius: '6px', cursor: 'pointer', fontSize: '14px',
          }}
        >
          Search
        </button>
      </div>

      {loading && <LoadingSpinner message="Searching…" />}
      {error && <ErrorMessage error={error} />}

      {result && !loading && (
        <>
          <p style={{ fontSize: '13px', color: '#8b949e', marginBottom: '14px' }}>
            {functions.length > 0
              ? `${functions.length} function(s) across ${browsers.length} browser(s).`
              : `No functions matching "${query}" found.`}
          </p>
          {functions.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: '12px', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                <thead>
                  <tr>
                    <th style={{ ...thBase, textAlign: 'left' }}>Function</th>
                    {browsers.map(b => (
                      <th key={b} title={b} style={thBrowser}>{shortBrowserLabel(b)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {functions.map(fn => (
                    <tr key={fn.name}>
                      <td
                        title={fn.name}
                        style={{
                          padding: '5px 10px', borderBottom: '1px solid #161b22',
                          textAlign: 'left', fontSize: '12px', whiteSpace: 'nowrap',
                          maxWidth: '340px', overflow: 'hidden', textOverflow: 'ellipsis',
                          fontFamily: 'monospace',
                        }}
                      >
                        {fn.name}
                      </td>
                      {browsers.map(b => {
                        const v = fn.support[b];
                        if (v == null) {
                          return (
                            <td key={b} title="not found" style={{ padding: '5px 10px', borderBottom: '1px solid #161b22', textAlign: 'center', color: '#f85149', opacity: 0.5, fontSize: '14px' }}>
                              ✗
                            </td>
                          );
                        }
                        const native = v.includes('[native code]');
                        return (
                          <td key={b} title={v} style={{ padding: '5px 10px', borderBottom: '1px solid #161b22', textAlign: 'center', color: native ? '#3fb950' : '#f0883e', fontSize: '14px' }}>
                            {native ? '✓' : '~'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ marginTop: '14px', fontSize: '11px', color: '#8b949e' }}>
                ✓ native &nbsp; ~ polyfill/non-native &nbsp; ✗ not found in this browser
              </p>
            </div>
          )}
        </>
      )}

      {!result && !loading && !error && (
        <p style={{ color: '#8b949e', fontSize: '13px' }}>Type a function name and press Search.</p>
      )}
    </div>
  );
}
