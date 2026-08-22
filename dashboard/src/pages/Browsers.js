import React, { useState, useEffect } from 'react';

const API_URL = import.meta.env.VITE_API_URL || '';

const RUN_MODES = [
  { id: 'extractor',     label: 'Extractor',     description: 'Collect window.* properties for all selected browsers' },
  { id: 'interceptions', label: 'Interceptions',  description: 'Capture all JS function calls during detection' },
];

const OS_LIST = [
  { id: 'windows', label: 'Windows', color: '#58a6ff' },
  { id: 'linux',   label: 'Linux',   color: '#3fb950' },
];

const s = {
  page:         { padding: '28px', minHeight: '100vh', fontFamily: "'Segoe UI', Tahoma, sans-serif" },
  h1:           { fontSize: '22px', color: '#58a6ff', marginBottom: '6px' },
  sub:          { fontSize: '13px', color: '#8b949e', marginBottom: '28px' },
  section:      { marginBottom: '28px' },
  sectionTitle: { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.5px', color: '#8b949e', marginBottom: '12px', fontWeight: 600 },
  row:          { display: 'flex', gap: '12px', flexWrap: 'wrap' },

  // Run mode radio cards
  modeCard: (selected) => ({
    background:   selected ? '#1f6feb22' : '#161b22',
    border:       `1px solid ${selected ? '#1f6feb' : '#30363d'}`,
    borderRadius: '8px',
    padding:      '12px 18px',
    cursor:       'pointer',
    transition:   'border-color .15s, background .15s',
    minWidth:     '180px',
  }),
  modeLabel: (selected) => ({
    fontSize:     '13px',
    fontWeight:   600,
    color:        selected ? '#58a6ff' : '#c9d1d9',
    marginBottom: '4px',
  }),
  modeDesc: { fontSize: '11px', color: '#8b949e', lineHeight: 1.5 },

  // OS checkbox cards
  osCard: (checked, color) => ({
    background:   checked ? `${color}18` : '#161b22',
    border:       `1px solid ${checked ? color : '#30363d'}`,
    borderRadius: '8px',
    padding:      '10px 16px',
    cursor:       'pointer',
    display:      'flex',
    alignItems:   'center',
    gap:          '10px',
    transition:   'border-color .15s, background .15s',
    minWidth:     '120px',
    userSelect:   'none',
  }),
  osLabel: (checked, color) => ({
    fontSize:   '14px',
    fontWeight: 600,
    color:      checked ? color : '#c9d1d9',
  }),
  checkbox: (checked, color) => ({
    width:       '16px',
    height:      '16px',
    borderRadius:'3px',
    border:      `2px solid ${checked ? color : '#30363d'}`,
    background:  checked ? color : 'transparent',
    flexShrink:  0,
    display:     'flex',
    alignItems:  'center',
    justifyContent: 'center',
    fontSize:    '10px',
    color:       '#fff',
  }),

  // Browser version section
  browserCard: {
    background:   '#161b22',
    border:       '1px solid #30363d',
    borderRadius: '8px',
    padding:      '16px 18px',
    marginBottom: '16px',
  },
  browserHeader: {
    display:      'flex',
    alignItems:   'center',
    gap:          '12px',
    marginBottom: '12px',
    flexWrap:     'wrap',
  },
  browserTitle: { fontSize: '14px', fontWeight: 600, color: '#c9d1d9', marginRight: '4px' },
  quickBtn: {
    background:   '#21262d',
    border:       '1px solid #30363d',
    borderRadius: '4px',
    color:        '#8b949e',
    fontSize:     '11px',
    padding:      '3px 8px',
    cursor:       'pointer',
    transition:   'border-color .1s, color .1s',
  },
  versionGrid: {
    display:      'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
    gap:          '6px',
    maxHeight:    '200px',
    overflowY:    'auto',
    padding:      '2px',
  },
  versionChip: (checked) => ({
    display:      'flex',
    alignItems:   'center',
    gap:          '7px',
    background:   checked ? '#1f6feb18' : '#0d1117',
    border:       `1px solid ${checked ? '#1f6feb' : '#21262d'}`,
    borderRadius: '5px',
    padding:      '5px 9px',
    cursor:       'pointer',
    fontSize:     '12px',
    color:        checked ? '#58a6ff' : '#8b949e',
    fontFamily:   'monospace',
    transition:   'border-color .1s, background .1s, color .1s',
    userSelect:   'none',
    whiteSpace:   'nowrap',
    overflow:     'hidden',
    textOverflow: 'ellipsis',
  }),
  versionDot: (checked) => ({
    width:       '8px',
    height:      '8px',
    borderRadius:'50%',
    background:  checked ? '#58a6ff' : '#30363d',
    flexShrink:  0,
  }),
  emptyVersions: { fontSize: '12px', color: '#6e7681', fontStyle: 'italic', padding: '8px 0' },

  // Submit
  btn: (disabled) => ({
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
  resultCard: (ok) => ({
    marginTop:    '12px',
    background:   ok ? '#0d2818' : '#2d1117',
    border:       `1px solid ${ok ? '#238636' : '#8b1a1a'}`,
    borderRadius: '8px',
    padding:      '12px 16px',
    fontSize:     '13px',
    color:        ok ? '#3fb950' : '#f85149',
  }),
  jobId: { fontFamily: 'monospace', fontSize: '12px', color: '#8b949e', marginTop: '4px' },

  // Loading / error states
  loadingBox: { fontSize: '13px', color: '#8b949e', padding: '12px 0' },
  errorBox:   { fontSize: '13px', color: '#f85149', background: '#2d1117', border: '1px solid #8b1a1a', borderRadius: '6px', padding: '10px 14px' },
  hint:       { fontSize: '12px', color: '#6e7681', marginLeft: '12px' },
};

// ── CheckboxTick ─────────────────────────────────────────────────────────────

function CheckboxTick({ checked, color = '#58a6ff' }) {
  return (
    <div style={s.checkbox(checked, color)}>
      {checked && '✓'}
    </div>
  );
}

// ── QuickSelectBar ────────────────────────────────────────────────────────────

function QuickSelectBar({ versions, selected, onSelect }) {
  return (
    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
      <button style={s.quickBtn} onClick={() => onSelect(new Set(versions))}>Select All</button>
      <button style={s.quickBtn} onClick={() => onSelect(new Set(versions.slice(0, 5)))}>Latest 5</button>
      <button style={s.quickBtn} onClick={() => onSelect(new Set(versions.slice(0, 10)))}>Latest 10</button>
      <button style={s.quickBtn} onClick={() => onSelect(new Set())}>None</button>
      <span style={{ fontSize: '11px', color: '#6e7681', alignSelf: 'center', marginLeft: '4px' }}>
        {selected.size} / {versions.length} selected
      </span>
    </div>
  );
}

// ── VersionGrid ───────────────────────────────────────────────────────────────

function VersionGrid({ versions, selected, onToggle }) {
  if (!versions || versions.length === 0) {
    return <div style={s.emptyVersions}>No versions available</div>;
  }
  return (
    <div style={s.versionGrid}>
      {versions.map(v => {
        const checked = selected.has(v);
        return (
          <div key={v} style={s.versionChip(checked)} onClick={() => onToggle(v)}>
            <div style={s.versionDot(checked)} />
            {v}
          </div>
        );
      })}
    </div>
  );
}

// ── BrowserSection ────────────────────────────────────────────────────────────

function BrowserSection({ title, versions, selected, onSelect, onToggle }) {
  return (
    <div style={s.browserCard}>
      <div style={s.browserHeader}>
        <span style={s.browserTitle}>{title}</span>
        <QuickSelectBar versions={versions} selected={selected} onSelect={onSelect} />
      </div>
      <VersionGrid versions={versions} selected={selected} onToggle={onToggle} />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Browsers() {
  const [runMode,       setRunMode]       = useState('extractor');
  const [selectedOS,    setSelectedOS]    = useState(new Set());
  const [chromeSel,     setChromeSel]     = useState(new Set());
  const [firefoxSel,    setFirefoxSel]    = useState(new Set());
  const [available,     setAvailable]     = useState(null);  // { windows, linux } or null
  const [loadingAvail,  setLoadingAvail]  = useState(true);
  const [availError,    setAvailError]    = useState(null);
  const [submitting,    setSubmitting]    = useState(false);
  const [results,       setResults]       = useState([]);   // [{os, ok, jobId?, message}]

  // Fetch available browser versions on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res  = await fetch(`${API_URL}/browsers/available`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (!cancelled) setAvailable(data);
      } catch (err) {
        if (!cancelled) setAvailError(err.message);
      } finally {
        if (!cancelled) setLoadingAvail(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Derive merged version lists across both OSes (union — show all known versions)
  const chromeVersions = available
    ? [...new Set([...(available.windows?.chrome || []), ...(available.linux?.chrome || [])])]
        .sort((a, b) => {
          // descending semver
          const ap = a.split('.').map(n => parseInt(n, 10) || 0);
          const bp = b.split('.').map(n => parseInt(n, 10) || 0);
          for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
            const d = (bp[i] || 0) - (ap[i] || 0);
            if (d !== 0) return d;
          }
          return 0;
        })
    : [];

  const firefoxVersions = available
    ? [...new Set([...(available.windows?.firefox || []), ...(available.linux?.firefox || [])])]
        .sort((a, b) => parseInt(b, 10) - parseInt(a, 10))
    : [];

  function toggleOS(id) {
    setSelectedOS(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setResults([]);
  }

  function toggleChrome(v) {
    setChromeSel(prev => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v); else next.add(v);
      return next;
    });
  }

  function toggleFirefox(v) {
    setFirefoxSel(prev => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v); else next.add(v);
      return next;
    });
  }

  const hasVersions = chromeSel.size > 0 || firefoxSel.size > 0;
  const canRun = selectedOS.size > 0 && hasVersions && !submitting;

  async function handleSubmit() {
    if (!canRun) return;
    setSubmitting(true);
    setResults([]);

    // Build shared browser_filter and version_list
    const filterParts = [];
    if (chromeSel.size > 0)  filterParts.push('chrome', 'chromedriver');
    if (firefoxSel.size > 0) filterParts.push('firefox', 'geckodriver');
    const browser_filter = filterParts.join(',');

    const version_list = {};
    if (chromeSel.size > 0)  version_list.chrome  = [...chromeSel];
    if (firefoxSel.size > 0) version_list.firefox = [...firefoxSel];

    const jobs = [...selectedOS].map(os => ({ os, platform: os }));

    const settled = await Promise.allSettled(
      jobs.map(async ({ os }) => {
        const res  = await fetch(`${API_URL}/jobs`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ platform: os, run_mode: runMode, browser_filter, version_list }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return { os, jobId: data.jobId };
      })
    );

    const newResults = settled.map((s, i) => {
      const os = jobs[i].os;
      if (s.status === 'fulfilled') {
        return { os, ok: true, jobId: s.value.jobId, message: `Job queued for ${os}. ECS task will start shortly.` };
      } else {
        return { os, ok: false, message: `${os}: ${s.reason?.message || 'Unknown error'}` };
      }
    });

    setResults(newResults);
    setSubmitting(false);
  }

  const osCount = selectedOS.size;
  const submitLabel = submitting
    ? 'Submitting…'
    : osCount === 0 ? 'Run Job'
    : `Run ${osCount} Job${osCount > 1 ? 's' : ''}`;

  return (
    <div style={s.page}>
      <h1 style={s.h1}>Run Browsers</h1>
      <p style={s.sub}>
        Select a run mode, target OSes, and specific browser versions, then submit.
        An ECS Fargate task launches per OS and writes results to S3.
      </p>

      {/* 1. Run Mode */}
      <div style={s.section}>
        <div style={s.sectionTitle}>1. Run Mode</div>
        <div style={s.row}>
          {RUN_MODES.map(m => (
            <div key={m.id} style={s.modeCard(runMode === m.id)} onClick={() => setRunMode(m.id)}>
              <div style={s.modeLabel(runMode === m.id)}>{m.label}</div>
              <div style={s.modeDesc}>{m.description}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 2. OS */}
      <div style={s.section}>
        <div style={s.sectionTitle}>2. Target OS</div>
        <div style={s.row}>
          {OS_LIST.map(os => {
            const checked = selectedOS.has(os.id);
            return (
              <div key={os.id} style={s.osCard(checked, os.color)} onClick={() => toggleOS(os.id)}>
                <CheckboxTick checked={checked} color={os.color} />
                <span style={s.osLabel(checked, os.color)}>{os.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. Browser Versions */}
      <div style={s.section}>
        <div style={s.sectionTitle}>3. Browser Versions</div>

        {loadingAvail && (
          <div style={s.loadingBox}>Loading available versions…</div>
        )}

        {availError && !loadingAvail && (
          <div style={s.errorBox}>Failed to load available versions: {availError}</div>
        )}

        {!loadingAvail && !availError && (
          <>
            <BrowserSection
              title="Chrome"
              versions={chromeVersions}
              selected={chromeSel}
              onSelect={setChromeSel}
              onToggle={toggleChrome}
            />
            <BrowserSection
              title="Firefox"
              versions={firefoxVersions}
              selected={firefoxSel}
              onSelect={setFirefoxSel}
              onToggle={toggleFirefox}
            />
          </>
        )}
      </div>

      {/* 4. Submit */}
      <div style={s.section}>
        <div style={s.sectionTitle}>4. Submit</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <button style={s.btn(!canRun)} onClick={handleSubmit} disabled={!canRun}>
            {submitLabel}
          </button>
          {selectedOS.size === 0 && (
            <span style={s.hint}>Select at least one OS</span>
          )}
          {selectedOS.size > 0 && !hasVersions && (
            <span style={s.hint}>Select at least one browser version</span>
          )}
        </div>

        {results.map((r, i) => (
          <div key={i} style={s.resultCard(r.ok)}>
            <div>{r.message}</div>
            {r.jobId && <div style={s.jobId}>Job ID: {r.jobId}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
