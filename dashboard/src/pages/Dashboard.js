import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getRuns, getRun } from '../api';
import RunView from '../components/RunView';
import LoadingSpinner from '../components/LoadingSpinner';

export default function Dashboard() {
  const [latestRun, setLatestRun]   = useState(null);
  const [loading,   setLoading]     = useState(true);
  const [error,     setError]       = useState(null);
  const [runType,   setRunType]     = useState('full'); // 'any' | 'mini' | 'full'

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLatestRun(null);
    setError(null);

    getRuns()
      .then(async runs => {
        if (cancelled) return;
        const filtered = runType === 'any' ? runs : runs.filter(r => r.run_type === runType);
        const latest = filtered[0]; // runs are ordered newest-first
        if (!latest) { setLoading(false); return; }
        const run = await getRun(latest.id);
        if (!cancelled) { setLatestRun(run); setLoading(false); }
      })
      .catch(err => { if (!cancelled) { setError(err); setLoading(false); } });

    return () => { cancelled = true; };
  }, [runType]);

  function OsBadge({ platform }) {
    if (!platform) return null;
    const isWin = platform === 'win32';
    const label = isWin ? 'Windows' : 'Linux';
    const emoji = isWin ? '🪟' : '🐧';
    const color = isWin ? '#5199e4' : '#e8a020';
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: '3px',
        background: isWin ? '#001d3d' : '#2d1a00',
        color, border: `1px solid ${isWin ? '#1a5276' : '#7d5a00'}`,
        borderRadius: '4px', padding: '1px 7px', fontSize: '11px',
        verticalAlign: 'middle', marginLeft: '6px',
      }}>
        {emoji} {label}
      </span>
    );
  }

  const tabStyle = (active) => ({
    padding: '6px 14px',
    borderRadius: '6px',
    border: `1px solid ${active ? '#58a6ff' : '#30363d'}`,
    background: active ? '#1f6feb22' : 'transparent',
    color: active ? '#58a6ff' : '#8b949e',
    fontSize: '12px',
    cursor: 'pointer',
    fontWeight: active ? 600 : 400,
  });

  return (
    <div style={{ padding: '28px', fontFamily: "'Segoe UI', Tahoma, sans-serif" }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
        <h1 style={{ fontSize: '22px', color: '#58a6ff', margin: 0 }}>
          Latest Detection Results
        </h1>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {[['any','Latest'], ['mini','Mini'], ['full','Full']].map(([v, label]) => (
            <button key={v} style={tabStyle(runType === v)} onClick={() => setRunType(v)}>{label}</button>
          ))}
          <Link to="/results" style={{ marginLeft: '12px', fontSize: '12px', color: '#8b949e' }}>All runs →</Link>
        </div>
      </div>

      {latestRun && (
        <p style={{ fontSize: '12px', color: '#6e7681', marginBottom: '20px' }}>
          Showing run {latestRun.id} ({latestRun.run_type}) — {latestRun.completed_at} — took {latestRun.elapsed}
          <OsBadge platform={latestRun.platform} />
        </p>
      )}

      {loading && <LoadingSpinner />}
      {!loading && !error && !latestRun && (
        <p style={{ color: '#6e7681', fontSize: '13px' }}>No detection runs found. <Link to="/browsers">Run one now →</Link></p>
      )}
      {!loading && <RunView run={latestRun} error={error} loading={false} />}
    </div>
  );
}
