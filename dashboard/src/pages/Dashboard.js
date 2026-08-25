import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getCombinedDashboard } from '../api';
import RunView from '../components/RunView';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';

export default function Dashboard() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    getCombinedDashboard()
      .then(d => { setData(d); setLoading(false); })
      .catch(err => { setError(err); setLoading(false); });
  }, []);

  // Convert combined.json shape into a synthetic run object that RunView understands.
  // Each browser entry carries its own `platform` and `completed_at`.
  const syntheticRun = data ? {
    id:           'combined',
    run_type:     'combined',
    platform:     null,
    completed_at: data.generated_at,
    results:      (data.browsers || []),
  } : null;

  return (
    <div style={{ padding: '28px', fontFamily: "'Segoe UI', Tahoma, sans-serif" }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
        <h1 style={{ fontSize: '22px', color: '#58a6ff', margin: 0 }}>
          Detection Results
        </h1>
        <Link to="/results" style={{ fontSize: '12px', color: '#8b949e' }}>All runs →</Link>
      </div>

      {data && (
        <p style={{ fontSize: '12px', color: '#6e7681', marginBottom: '20px' }}>
          Combined view — latest result per browser/OS across all runs.
          Last updated {data.generated_at}.
        </p>
      )}

      {loading && <LoadingSpinner />}
      {error && (
        error.message && error.message.includes('404')
          ? <p style={{ color: '#6e7681', fontSize: '13px' }}>
              No detection runs yet. <Link to="/browsers">Run one now →</Link>
            </p>
          : <ErrorMessage error={error} />
      )}
      {!loading && !error && <RunView run={syntheticRun} error={null} loading={false} />}
    </div>
  );
}
