import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getRuns } from '../api';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';

const pageStyle = {
  padding: '32px 28px',
  maxWidth: '1100px',
};

const thStyle = {
  textAlign: 'left',
  padding: '8px 12px',
  color: '#8b949e',
  fontWeight: 500,
  borderBottom: '1px solid #21262d',
  fontSize: '11px',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const tdStyle = {
  padding: '8px 12px',
  borderBottom: '1px solid #161b22',
  verticalAlign: 'middle',
  fontSize: '13px',
};

const typeColors = {
  mini:          { color: '#58a6ff', label: 'Mini (Detection)' },
  full:          { color: '#3fb950', label: 'Full (Detection)' },
  extractor:     { color: '#f0883e', label: 'Extractor' },
  'extractor-mini': { color: '#e8a020', label: 'Extractor Mini' },
  interceptions: { color: '#bc8cff', label: 'Interceptions' },
};

function TypeBadge({ runType }) {
  const t = typeColors[runType] || { color: '#8b949e', label: runType };
  return <span style={{ color: t.color }}>{t.label}</span>;
}

function OsBadge({ platform }) {
  if (!platform) return <span style={{ color: '#6e7681' }}>—</span>;
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
    }}>
      {emoji} {label}
    </span>
  );
}

function RunLink({ run }) {
  if (run.run_type === 'mini' || run.run_type === 'full') {
    return <Link to={`/run/${run.id}`}>/run/{run.id}</Link>;
  }
  if (run.run_type === 'interceptions') {
    return <Link to="/interceptions">Interceptions →</Link>;
  }
  if (run.run_type === 'extractor' || run.run_type === 'extractor-mini') {
    return <Link to="/diff">Diff →</Link>;
  }
  return <span style={{ color: '#6e7681' }}>—</span>;
}

export default function Results() {
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);

  useEffect(() => {
    getRuns()
      .then(setRuns)
      .catch(setError);
  }, []);

  if (error) return <ErrorMessage error={error} />;
  if (!runs) return <LoadingSpinner />;

  return (
    <div style={pageStyle}>
      <h1 style={{ fontSize: '24px', color: '#58a6ff', marginBottom: '8px' }}>
        All Runs
      </h1>
      <p style={{ fontSize: '13px', color: '#8b949e', marginBottom: '28px' }}>
        Detection, extraction, and interception runs — newest first
      </p>

      {runs.length === 0 ? (
        <p style={{ color: '#6e7681', padding: '20px', textAlign: 'center' }}>
          No runs stored yet.
        </p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>ID</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>OS</th>
              <th style={thStyle}>Completed at</th>
              <th style={thStyle}>Elapsed</th>
              <th style={thStyle}>Link</th>
            </tr>
          </thead>
          <tbody>
            {runs.map(r => (
              <tr
                key={r.id}
                style={{ cursor: 'default', background: hoveredId === r.id ? '#161b22' : 'transparent' }}
                onMouseEnter={() => setHoveredId(r.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '11px', color: '#8b949e', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.id}</td>
                <td style={tdStyle}><TypeBadge runType={r.run_type} /></td>
                <td style={tdStyle}><OsBadge platform={r.platform} /></td>
                <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{r.completed_at}</td>
                <td style={tdStyle}>{r.elapsed}</td>
                <td style={tdStyle}><RunLink run={r} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
