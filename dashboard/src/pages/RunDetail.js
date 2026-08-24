import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getRun } from '../api';
import RunView from '../components/RunView';

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
      borderRadius: '4px', padding: '2px 8px', fontSize: '12px',
      verticalAlign: 'middle',
    }}>
      {emoji} {label}
    </span>
  );
}

export default function RunDetail() {
  const { id } = useParams();
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getRun(id).then(setRun).catch(setError);
  }, [id]);

  const runLabel = run ? (run.run_type === 'mini' ? 'Mini' : run.run_type === 'full' ? 'Full' : run.run_type) : '';

  return (
    <div style={{ padding: '28px', fontFamily: "'Segoe UI', Tahoma, sans-serif" }}>
      {run && (
        <>
          <h1 style={{ fontSize: '26px', color: '#58a6ff', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            Browser Automation Detection Matrix
            <span style={{ fontSize: '12px', background: '#1f2937', color: '#58a6ff', border: '1px solid #30363d', borderRadius: '4px', padding: '2px 8px' }}>
              {runLabel} — {run.id}
            </span>
            <OsBadge platform={run.platform} />
          </h1>
          <p style={{ fontSize: '13px', color: '#8b949e', marginBottom: '20px' }}>
            <Link to="/results">← Results</Link>
            {' '}&nbsp;·&nbsp; Completed {run.completed_at} &nbsp;·&nbsp; Took {run.elapsed}
          </p>
        </>
      )}
      <RunView run={run} error={error} loading={!run && !error} />
      {run && (
        <p style={{ marginTop: '32px', fontSize: '11px', color: '#6e7681' }}>
          {(run.results || []).length} combinations tested · Took {run.elapsed} · Results received {run.completed_at}
        </p>
      )}
    </div>
  );
}
