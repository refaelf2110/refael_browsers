import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getRuns } from '../api';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';

const pageStyle = {
  padding: '32px 28px',
  maxWidth: '1100px',
};

const cardStyle = {
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: '8px',
  padding: '16px 22px',
  fontSize: '14px',
};

const sectionHeadStyle = {
  fontSize: '13px',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  color: '#8b949e',
  marginBottom: '16px',
  paddingBottom: '8px',
  borderBottom: '1px solid #21262d',
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

export default function Dashboard() {
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getRuns()
      .then(setRuns)
      .catch(setError);
  }, []);

  if (error) return <ErrorMessage error={error} />;
  if (!runs) return <LoadingSpinner />;

  const latest = { mini: null, full: null };
  for (const r of runs) {
    if (!latest[r.run_type]) latest[r.run_type] = r;
  }

  return (
    <div style={pageStyle}>
      <h1 style={{ fontSize: '24px', color: '#58a6ff', marginBottom: '8px' }}>
        Browser Detection Matrix
      </h1>
      <p style={{ fontSize: '13px', color: '#8b949e', marginBottom: '28px' }}>
        Results dashboard — data from API backend
      </p>

      <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', marginBottom: '32px' }}>
        <div style={cardStyle}>
          {latest.mini ? (
            <>
              <Link to={`/run/${latest.mini.id}`} style={{ color: '#58a6ff', fontSize: '14px' }}>
                Latest Mini results
              </Link>{' '}
              <span style={{ color: '#8b949e', fontSize: '13px' }}>
                — run #{latest.mini.id}, {latest.mini.completed_at}
              </span>
            </>
          ) : (
            <span style={{ color: '#6e7681' }}>No mini run yet</span>
          )}
        </div>
        <div style={cardStyle}>
          {latest.full ? (
            <>
              <Link to={`/run/${latest.full.id}`} style={{ color: '#3fb950', fontSize: '14px' }}>
                Latest Full results
              </Link>{' '}
              <span style={{ color: '#8b949e', fontSize: '13px' }}>
                — run #{latest.full.id}, {latest.full.completed_at}
              </span>
            </>
          ) : (
            <span style={{ color: '#6e7681' }}>No full run yet</span>
          )}
        </div>
      </div>

      <h2 style={sectionHeadStyle}>All Runs</h2>

      {runs.length === 0 ? (
        <p style={{ color: '#6e7681', padding: '20px', textAlign: 'center' }}>
          No runs stored yet.
        </p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>#</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Completed at</th>
              <th style={thStyle}>Elapsed</th>
              <th style={thStyle}>Link</th>
            </tr>
          </thead>
          <tbody>
            {runs.map(r => (
              <tr
                key={r.id}
                style={{ cursor: 'default' }}
                onMouseEnter={e => {
                  Array.from(e.currentTarget.cells).forEach(td => {
                    td.style.background = '#161b22';
                  });
                }}
                onMouseLeave={e => {
                  Array.from(e.currentTarget.cells).forEach(td => {
                    td.style.background = 'transparent';
                  });
                }}
              >
                <td style={tdStyle}>{r.id}</td>
                <td style={tdStyle}>
                  {r.run_type === 'mini' ? (
                    <span style={{ color: '#58a6ff' }}>Mini</span>
                  ) : (
                    <span style={{ color: '#3fb950' }}>Full</span>
                  )}
                </td>
                <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{r.completed_at}</td>
                <td style={tdStyle}>{r.elapsed}</td>
                <td style={tdStyle}>
                  <Link to={`/run/${r.id}`}>/run/{r.id}</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
