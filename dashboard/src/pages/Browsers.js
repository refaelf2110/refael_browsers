import React, { useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || '';

const PLATFORMS = [
  {
    id: 'linux',
    label: 'Linux',
    description: 'Playwright, Puppeteer, Selenium, WebdriverIO, Taiko, Cypress, TestCafe',
    color: '#3fb950',
  },
  {
    id: 'windows',
    label: 'Windows',
    description: 'Chrome, Edge, Selenium on Windows Server 2022 (Desktop Experience)',
    color: '#58a6ff',
  },
];

const RUN_MODES = [
  { id: 'mini',           label: 'Mini',           description: '3 versions per browser — quick sample' },
  { id: 'full',           label: 'Full',            description: 'All available browser versions' },
  { id: 'extractor',      label: 'Extractor',       description: 'Collect window.* properties for all browsers' },
  { id: 'extractor-mini', label: 'Extractor Mini',  description: 'Collect window.* properties — 2 versions per browser' },
  { id: 'interceptions',  label: 'Interceptions',   description: 'Capture all JS function calls during detection' },
  { id: 'download',       label: 'Download Only',   description: 'Download browsers without running tests' },
];

const s = {
  page:        { padding: '28px', minHeight: '100vh', fontFamily: "'Segoe UI', Tahoma, sans-serif" },
  h1:          { fontSize: '22px', color: '#58a6ff', marginBottom: '6px' },
  sub:         { fontSize: '13px', color: '#8b949e', marginBottom: '28px' },
  section:     { marginBottom: '28px' },
  sectionTitle:{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.5px', color: '#8b949e', marginBottom: '12px', fontWeight: 600 },
  grid:        { display: 'flex', gap: '12px', flexWrap: 'wrap' },
  card:        (selected, color) => ({
    background:  selected ? `${color}18` : '#161b22',
    border:      `1px solid ${selected ? color : '#30363d'}`,
    borderRadius:'8px',
    padding:     '14px 18px',
    cursor:      'pointer',
    transition:  'border-color .15s, background .15s',
    minWidth:    '160px',
  }),
  cardLabel:   (selected, color) => ({
    fontSize:   '14px',
    fontWeight: 600,
    color:      selected ? color : '#c9d1d9',
    marginBottom: '4px',
  }),
  cardDesc:    { fontSize: '11px', color: '#8b949e', lineHeight: 1.5 },
  modeCard:    (selected) => ({
    background:   selected ? '#1f6feb22' : '#161b22',
    border:       `1px solid ${selected ? '#1f6feb' : '#30363d'}`,
    borderRadius: '8px',
    padding:      '12px 16px',
    cursor:       'pointer',
    transition:   'border-color .15s, background .15s',
    minWidth:     '180px',
    flex:         '1 1 180px',
    maxWidth:     '260px',
  }),
  modeLabel:   (selected) => ({
    fontSize:     '13px',
    fontWeight:   600,
    color:        selected ? '#58a6ff' : '#c9d1d9',
    marginBottom: '4px',
  }),
  modeDesc:    { fontSize: '11px', color: '#8b949e', lineHeight: 1.5 },
  btn:         (disabled) => ({
    background:   disabled ? '#21262d' : '#1f6feb',
    color:        disabled ? '#6e7681' : '#fff',
    border:       'none',
    borderRadius: '6px',
    padding:      '10px 24px',
    fontSize:     '14px',
    cursor:       disabled ? 'not-allowed' : 'pointer',
    fontWeight:   600,
    transition:   'background .15s',
  }),
  result:      (ok) => ({
    marginTop:    '20px',
    background:   ok ? '#0d2818' : '#2d1117',
    border:       `1px solid ${ok ? '#238636' : '#8b1a1a'}`,
    borderRadius: '8px',
    padding:      '14px 18px',
    fontSize:     '13px',
    color:        ok ? '#3fb950' : '#f85149',
  }),
  jobId:       { fontFamily: 'monospace', fontSize: '12px', color: '#8b949e', marginTop: '6px' },
};

export default function Browsers() {
  const [platform, setPlatform] = useState(null);
  const [runMode,  setRunMode]  = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [result,   setResult]   = useState(null);

  async function handleRun() {
    if (!platform || !runMode) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`${API_URL}/jobs`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ platform, run_mode: runMode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResult({ ok: true, jobId: data.jobId, message: 'Job queued successfully. The ECS task will start shortly.' });
    } catch (err) {
      setResult({ ok: false, message: err.message });
    } finally {
      setLoading(false);
    }
  }

  const canRun = platform && runMode && !loading;

  return (
    <div style={s.page}>
      <h1 style={s.h1}>Run Browsers</h1>
      <p style={s.sub}>Select a platform and run mode, then submit a job. An ECS Fargate task will launch and write results to S3.</p>

      <div style={s.section}>
        <div style={s.sectionTitle}>1. Platform</div>
        <div style={s.grid}>
          {PLATFORMS.map(p => (
            <div key={p.id} style={s.card(platform === p.id, p.color)} onClick={() => setPlatform(p.id)}>
              <div style={s.cardLabel(platform === p.id, p.color)}>{p.label}</div>
              <div style={s.cardDesc}>{p.description}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={s.section}>
        <div style={s.sectionTitle}>2. Run Mode</div>
        <div style={s.grid}>
          {RUN_MODES.map(m => (
            <div key={m.id} style={s.modeCard(runMode === m.id)} onClick={() => setRunMode(m.id)}>
              <div style={s.modeLabel(runMode === m.id)}>{m.label}</div>
              <div style={s.modeDesc}>{m.description}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={s.section}>
        <div style={s.sectionTitle}>3. Submit</div>
        <button style={s.btn(!canRun)} onClick={handleRun} disabled={!canRun}>
          {loading ? 'Submitting…' : 'Run Job'}
        </button>
        {(!platform || !runMode) && (
          <span style={{ fontSize: '12px', color: '#6e7681', marginLeft: '12px' }}>
            Select a platform and run mode first
          </span>
        )}
      </div>

      {result && (
        <div style={s.result(result.ok)}>
          <div>{result.message}</div>
          {result.jobId && <div style={s.jobId}>Job ID: {result.jobId}</div>}
        </div>
      )}
    </div>
  );
}
