import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getInterceptions } from '../api';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';

const thStyle = {
  textAlign: 'left', padding: '8px 12px', color: '#8b949e',
  fontWeight: 500, borderBottom: '1px solid #21262d',
  fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px',
};

const tdStyle = {
  padding: '8px 12px', borderBottom: '1px solid #161b22', verticalAlign: 'middle', fontSize: '13px',
};

export default function Interceptions() {
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getInterceptions()
      .then(setSessions)
      .catch(setError);
  }, []);

  if (error) return <ErrorMessage error={error} />;
  if (!sessions) return <LoadingSpinner />;

  return (
    <div style={{ padding: '32px 28px' }}>
      <h1 style={{ fontSize: '22px', color: '#58a6ff', marginBottom: '6px' }}>Interceptions — Sessions</h1>
      <p style={{ fontSize: '13px', color: '#8b949e', marginBottom: '24px' }}>
        <Link to="/">← Dashboard</Link>
      </p>

      {sessions.length === 0 ? (
        <p style={{ color: '#6e7681', padding: '20px', textAlign: 'center' }}>
          No interception sessions yet.
        </p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>#</th>
              <th style={thStyle}>Framework</th>
              <th style={thStyle}>Browser</th>
              <th style={thStyle}>Started</th>
              <th style={thStyle}>Done (UTC)</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Calls</th>
              <th style={thStyle}>Detail</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map(s => (
              <tr
                key={s.id}
                onMouseEnter={e => Array.from(e.currentTarget.cells).forEach(td => { td.style.background = '#161b22'; })}
                onMouseLeave={e => Array.from(e.currentTarget.cells).forEach(td => { td.style.background = 'transparent'; })}
              >
                <td style={tdStyle}>{s.id}</td>
                <td style={tdStyle}>
                  <span style={{ color: '#58a6ff' }}>{s.framework}</span>
                </td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '11px' }}>{s.browser_label}</td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '11px' }}>{s.started_at}</td>
                <td style={tdStyle}>
                  {s.completed_at
                    ? s.completed_at.slice(11, 19)
                    : <span style={{ color: '#f85149' }}>running</span>}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{s.action_count}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{s.call_count}</td>
                <td style={tdStyle}>
                  <Link to={`/interceptions/${s.id}`}>/interceptions/{s.id}</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
