'use strict';
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getBrowsersNew } from '../api';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';

const API_URL = import.meta.env.VITE_API_URL || '';

const OS_LIST = [
  { id: 'windows', label: 'Windows', color: '#58a6ff' },
  { id: 'linux',   label: 'Linux',   color: '#3fb950' },
];

const s = {
  page:         { padding: '28px', maxWidth: '1000px' },
  h1:           { fontSize: '22px', color: '#58a6ff', marginBottom: '6px' },
  sub:          { fontSize: '13px', color: '#8b949e', marginBottom: '28px' },
  section:      { marginBottom: '28px' },
  sectionTitle: { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.5px', color: '#8b949e', marginBottom: '12px', fontWeight: 600 },
  row:          { display: 'flex', gap: '12px', flexWrap: 'wrap' },

  osCard: (checked, color) => ({
    background:   checked ? `${color}18` : '#161b22',
    border:       `1px solid ${checked ? color : '#30363d'}`,
    borderRadius: '8px', padding: '10px 16px', cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: '10px',
    transition: 'border-color .15s, background .15s',
    minWidth: '120px', userSelect: 'none',
  }),
  osLabel: (checked, color) => ({ fontSize: '14px', fontWeight: 600, color: checked ? color : '#c9d1d9' }),
  checkbox: (checked, color) => ({
    width: '16px', height: '16px', borderRadius: '3px',
    border: `2px solid ${checked ? color : '#30363d'}`,
    background: checked ? color : 'transparent',
    flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '10px', color: '#fff',
  }),

  card: {
    background: '#161b22', border: '1px solid #30363d',
    borderRadius: '8px', padding: '16px 18px', marginBottom: '16px',
  },
  cardHeader: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' },
  cardTitle:  { fontSize: '14px', fontWeight: 600, color: '#c9d1d9' },
  badge: (count) => ({
    background: count > 0 ? '#1f6feb22' : '#21262d',
    color:      count > 0 ? '#58a6ff'   : '#6e7681',
    border:     `1px solid ${count > 0 ? '#1f6feb' : '#30363d'}`,
    borderRadius: '12px', padding: '2px 10px', fontSize: '11px', fontWeight: 600,
  }),
  quickBtn: {
    background: '#21262d', border: '1px solid #30363d', borderRadius: '4px',
    color: '#8b949e', fontSize: '11px', padding: '3px 8px', cursor: 'pointer',
  },
  grid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '6px', maxHeight: '220px', overflowY: 'auto', padding: '2px',
  },
  chip: (checked) => ({
    display: 'flex', alignItems: 'center', gap: '7px',
    background: checked ? '#1f6feb18' : '#0d1117',
    border: `1px solid ${checked ? '#1f6feb' : '#21262d'}`,
    borderRadius: '5px', padding: '5px 9px', cursor: 'pointer',
    fontSize: '12px', color: checked ? '#58a6ff' : '#8b949e',
    fontFamily: 'monospace', userSelect: 'none', whiteSpace: 'nowrap',
    overflow: 'hidden', textOverflow: 'ellipsis',
  }),
  dot: (checked) => ({
    width: '8px', height: '8px', borderRadius: '50%',
    background: checked ? '#58a6ff' : '#30363d', flexShrink: 0,
  }),
  empty: { fontSize: '12px', color: '#3fb950', padding: '8px 0', fontStyle: 'italic' },
  btn: (disabled) => ({
    background: disabled ? '#21262d' : '#1f6feb',
    color: disabled ? '#6e7681' : '#fff',
    border: 'none', borderRadius: '6px', padding: '10px 24px',
    fontSize: '14px', cursor: disabled ? 'not-allowed' : 'pointer', fontWeight: 600,
  }),
  resultCard: (ok) => ({
    marginTop: '12px',
    background: ok ? '#0d2818' : '#2d1117',
    border: `1px solid ${ok ? '#238636' : '#8b1a1a'}`,
    borderRadius: '8px', padding: '12px 16px', fontSize: '13px',
    color: ok ? '#3fb950' : '#f85149',
  }),
  jobId:   { fontFamily: 'monospace', fontSize: '12px', color: '#8b949e', marginTop: '4px' },
  note:    { fontSize: '12px', color: '#8b949e', marginTop: '8px', lineHeight: 1.6 },
  osSep:   { fontSize: '11px', color: '#8b949e', fontWeight: 600, marginBottom: '8px', marginTop: '4px' },
};

function CheckboxTick({ checked, color = '#58a6ff' }) {
  return <div style={s.checkbox(checked, color)}>{checked && '✓'}</div>;
}

function VersionGrid({ versions, selected, onToggle }) {
  if (!versions || versions.length === 0) {
    return <div style={s.empty}>All versions already cached</div>;
  }
  return (
    <div style={s.grid}>
      {versions.map(v => {
        const checked = selected.has(v);
        return (
          <div key={v} style={s.chip(checked)} onClick={() => onToggle(v)}>
            <div style={s.dot(checked)} />
            {v}
          </div>
        );
      })}
    </div>
  );
}

function BrowserCard({ title, osVersions, selected, onSelect, onToggle }) {
  // Merge versions across all shown OSes for display, keyed by version string
  const allVersions = [...new Set(Object.values(osVersions).flatMap(d => d.new))];
  const newCount = allVersions.length;

  return (
    <div style={s.card}>
      <div style={s.cardHeader}>
        <span style={s.cardTitle}>{title}</span>
        <span style={s.badge(newCount)}>{newCount} new</span>
        {newCount > 0 && (
          <>
            <button style={s.quickBtn} onClick={() => onSelect(new Set(allVersions))}>Select All</button>
            <button style={s.quickBtn} onClick={() => onSelect(new Set())}>None</button>
            <span style={{ fontSize: '11px', color: '#6e7681', alignSelf: 'center' }}>
              {selected.size} selected
            </span>
          </>
        )}
      </div>

      {Object.entries(osVersions).map(([os, data]) => (
        <div key={os}>
          <div style={s.osSep}>{os.charAt(0).toUpperCase() + os.slice(1)} — {data.cached.length} cached, {data.new.length} new</div>
          <VersionGrid versions={data.new} selected={selected} onToggle={onToggle} />
        </div>
      ))}
    </div>
  );
}

export default function BrowserDownload() {
  const [data,       setData]       = useState(null);
  const [error,      setError]      = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [selectedOS, setSelectedOS] = useState(new Set(['windows', 'linux']));
  const [chromeSel,  setChromeSel]  = useState(new Set());
  const [firefoxSel, setFirefoxSel] = useState(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [results,    setResults]    = useState([]);

  useEffect(() => {
    getBrowsersNew()
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  function toggleOS(id) {
    setSelectedOS(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleChrome(v) {
    setChromeSel(prev => { const n = new Set(prev); n.has(v) ? n.delete(v) : n.add(v); return n; });
  }

  function toggleFirefox(v) {
    setFirefoxSel(prev => { const n = new Set(prev); n.has(v) ? n.delete(v) : n.add(v); return n; });
  }

  // Build per-OS version data filtered to selected OSes
  const activeOSes = selectedOS.size > 0 ? [...selectedOS] : ['windows', 'linux'];

  const chromeByOS = data
    ? Object.fromEntries(activeOSes.map(os => [os, data[os]?.chrome || { cached: [], new: [] }]))
    : {};
  const firefoxByOS = data
    ? Object.fromEntries(activeOSes.map(os => [os, data[os]?.firefox || { cached: [], new: [] }]))
    : {};

  const hasSelection = chromeSel.size > 0 || firefoxSel.size > 0;
  const canSubmit = selectedOS.size > 0 && hasSelection && !submitting;

  async function handleDownload() {
    if (!canSubmit) return;
    setSubmitting(true);
    setResults([]);

    const filterParts = [];
    const version_list = {};
    if (chromeSel.size > 0)  { filterParts.push('chrome', 'chromedriver'); version_list.chrome  = [...chromeSel]; }
    if (firefoxSel.size > 0) { filterParts.push('firefox', 'geckodriver'); version_list.firefox = [...firefoxSel]; }
    const browser_filter = filterParts.join(',');

    const settled = await Promise.allSettled(
      [...selectedOS].map(async os => {
        const res = await fetch(`${API_URL}/jobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platform: os, run_mode: 'download', browser_filter, version_list }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
        return { os, jobId: d.jobId };
      })
    );

    setResults(settled.map((s, i) => {
      const os = [...selectedOS][i];
      if (s.status === 'fulfilled') {
        return { os, ok: true, jobId: s.value.jobId, message: `Download job queued for ${os}.` };
      }
      return { os, ok: false, message: `${os}: ${s.reason?.message || 'Unknown error'}` };
    }));
    setSubmitting(false);
  }

  return (
    <div style={s.page}>
      <h1 style={s.h1}>New Browser Versions</h1>
      <p style={s.sub}>
        <Link to="/browsers">← Run Browsers</Link>
        &nbsp;&nbsp;Browser versions available upstream but not yet in your S3 cache.
        Select versions and submit a download job to cache them.
      </p>

      {/* OS filter */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Filter by OS</div>
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

      {/* Browser version lists */}
      {loading && <LoadingSpinner />}
      {error   && <ErrorMessage error={error} />}

      {!loading && !error && (
        <>
          <div style={s.section}>
            <div style={s.sectionTitle}>Chrome</div>
            <BrowserCard
              title="Chrome for Testing"
              osVersions={chromeByOS}
              selected={chromeSel}
              onSelect={setChromeSel}
              onToggle={toggleChrome}
            />
          </div>

          <div style={s.section}>
            <div style={s.sectionTitle}>Firefox</div>
            <BrowserCard
              title="Firefox"
              osVersions={firefoxByOS}
              selected={firefoxSel}
              onSelect={setFirefoxSel}
              onToggle={toggleFirefox}
            />
          </div>

          {/* Submit */}
          <div style={s.section}>
            <div style={s.sectionTitle}>Download</div>
            <button style={s.btn(!canSubmit)} onClick={handleDownload} disabled={!canSubmit}>
              {submitting ? 'Submitting…' : `Download to ${[...selectedOS].join(' + ') || '…'}`}
            </button>
            <p style={s.note}>
              A download job will be launched per selected OS. The container downloads selected browser
              versions from upstream and uploads them to S3. Existing cached versions are not re-downloaded.
            </p>

            {results.map((r, i) => (
              <div key={i} style={s.resultCard(r.ok)}>
                <div>{r.message}</div>
                {r.jobId && <div style={s.jobId}>Job ID: {r.jobId}</div>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
