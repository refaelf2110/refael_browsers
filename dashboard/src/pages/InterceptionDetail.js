import React, { useEffect, useState, useMemo } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { getInterception } from '../api';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';

const OWN_CALL_MARKERS = ['cheq_setAction', 'cheq_getBuffer', 'cheq_restoreInterceptions'];
const PAGE_SIZE = 500;

function isOwnCall(row) {
  const stack = row.stack || '';
  const args = row.args_json || '';
  return OWN_CALL_MARKERS.some(n => stack.includes(n) || args.includes(n));
}

function extractCaller(stack) {
  const lines = (stack || '').split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('at ') && !t.includes('intercepted_') && !t.startsWith('at Error')) {
      return t.slice(3);
    }
  }
  return '';
}

function parseArgs(argsJson) {
  if (!argsJson) return [];
  try { return JSON.parse(argsJson); } catch { return [argsJson]; }
}

function CallCard({ row, sessionId, stacksOpen }) {
  const [stackOpen, setStackOpen] = useState(stacksOpen);
  const args = parseArgs(row.args_json);
  const caller = row.caller || extractCaller(row.stack);
  const stackStr = (row.stack || '').replace(/^Error\n?/, '').trim();
  const stackLines = stackStr ? stackStr.split('\n') : [];
  const retVal = row.return_val && row.return_val !== 'undefined' && row.return_val !== 'null' ? row.return_val : '';
  const thisVal = row.this_arg && row.this_arg !== '[Window]' && row.this_arg !== 'undefined' ? row.this_arg : '';
  const durStr = row.duration_ms > 0 ? `${Number(row.duration_ms).toFixed(2)}ms` : '';
  const isCtor = row.is_constructor === 1;

  return (
    <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: '7px', padding: '11px 14px', marginBottom: '9px', fontSize: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '10px', color: '#6e7681', fontFamily: 'monospace', minWidth: '36px' }}>#{row.seq}</span>
        <span style={{ background: '#f0883e22', color: '#f0883e', border: '1px solid #f0883e44', borderRadius: '4px', padding: '1px 7px', fontSize: '11px', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
          {row.action}
        </span>
        <Link
          to={`/interceptions/${sessionId}?fn=${encodeURIComponent(row.fn_name)}`}
          style={{ color: '#79c0ff', fontFamily: 'monospace', fontSize: '13px', fontWeight: 600, wordBreak: 'break-all', textDecoration: 'none' }}
        >
          {row.fn_name}
        </Link>
        {isCtor && (
          <span style={{ background: '#1f6feb33', color: '#58a6ff', border: '1px solid #1f6feb55', borderRadius: '4px', padding: '1px 6px', fontSize: '10px' }}>new</span>
        )}
        {durStr && (
          <span style={{ fontSize: '10px', color: '#6e7681', fontFamily: 'monospace' }}>{durStr}</span>
        )}
      </div>

      {thisVal && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', marginTop: '4px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '10px', color: '#6e7681', textTransform: 'uppercase', letterSpacing: '0.4px', minWidth: '42px', flexShrink: 0, paddingTop: '2px' }}>This</span>
          <code style={{ fontFamily: 'monospace', fontSize: '11px', color: '#d2a8ff', wordBreak: 'break-all' }}>{thisVal}</code>
        </div>
      )}

      {caller && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', marginTop: '4px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '10px', color: '#6e7681', textTransform: 'uppercase', letterSpacing: '0.4px', minWidth: '42px', flexShrink: 0, paddingTop: '2px' }}>Caller</span>
          <code style={{ fontFamily: 'monospace', fontSize: '11px', color: '#3fb950', wordBreak: 'break-all' }}>{caller}</code>
        </div>
      )}

      {args.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', marginTop: '4px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '10px', color: '#6e7681', textTransform: 'uppercase', letterSpacing: '0.4px', minWidth: '42px', flexShrink: 0, paddingTop: '2px' }}>Args</span>
          <span style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {args.map((a, i) => (
              <code key={i} style={{ background: '#1a2233', color: '#e6c07b', padding: '1px 6px', borderRadius: '3px', fontFamily: 'monospace', fontSize: '11px', wordBreak: 'break-all' }}>
                {String(a)}
              </code>
            ))}
          </span>
        </div>
      )}

      {retVal && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', marginTop: '4px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '10px', color: '#6e7681', textTransform: 'uppercase', letterSpacing: '0.4px', minWidth: '42px', flexShrink: 0, paddingTop: '2px' }}>Returns</span>
          <code style={{ fontFamily: 'monospace', fontSize: '11px', color: '#a5d6ff', wordBreak: 'break-all' }}>{retVal}</code>
        </div>
      )}

      {stackLines.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', marginTop: '4px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '10px', color: '#6e7681', textTransform: 'uppercase', letterSpacing: '0.4px', minWidth: '42px', flexShrink: 0, paddingTop: '2px' }}>Stack</span>
          <div>
            <button
              onClick={() => setStackOpen(o => !o)}
              style={{ background: 'none', border: 'none', color: '#8b949e', fontSize: '10px', cursor: 'pointer', padding: '2px 0', userSelect: 'none' }}
            >
              {stackOpen ? '▾' : '▸'} {stackLines.length} frames
            </button>
            {stackOpen && (
              <pre style={{ fontFamily: 'monospace', fontSize: '10px', color: '#8b949e', whiteSpace: 'pre-wrap', wordBreak: 'break-all', marginTop: '5px', padding: '8px 10px', background: '#0d1117', border: '1px solid #21262d', borderRadius: '4px', lineHeight: 1.5 }}>
                {stackStr}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function InterceptionDetail() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const actionFilter = searchParams.get('action') || '';
  const fnFilter = searchParams.get('fn') || '';
  const page = parseInt(searchParams.get('page') || '0', 10);

  useEffect(() => {
    getInterception(id)
      .then(setData)
      .catch(setError);
  }, [id]);

  const { session, allCalls, actions, topFns } = useMemo(() => {
    if (!data) return { session: null, allCalls: [], actions: [], topFns: [] };
    const session = data.session;
    const rawCalls = (data.calls || []).filter(r => !isOwnCall(r));

    // Compute unique actions and top functions from all (unfiltered) calls
    const actionCounts = {};
    const fnCounts = {};
    for (const r of rawCalls) {
      actionCounts[r.action] = (actionCounts[r.action] || 0) + 1;
      fnCounts[r.fn_name] = (fnCounts[r.fn_name] || 0) + 1;
    }
    const actions = Object.entries(actionCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([action, cnt]) => ({ action, cnt }));
    const topFns = Object.entries(fnCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([fn_name, cnt]) => ({ fn_name, cnt }));

    return { session, allCalls: rawCalls, actions, topFns };
  }, [data]);

  const filteredCalls = useMemo(() => {
    return allCalls.filter(r => {
      if (actionFilter && r.action !== actionFilter) return false;
      if (fnFilter && !r.fn_name.includes(fnFilter)) return false;
      return true;
    });
  }, [allCalls, actionFilter, fnFilter]);

  const totalPages = Math.ceil(filteredCalls.length / PAGE_SIZE);
  const pageCalls = filteredCalls.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const stacksOpen = !!(actionFilter || fnFilter);

  const applyFilter = (newAction, newFn) => {
    const params = {};
    if (newAction) params.action = newAction;
    if (newFn) params.fn = newFn;
    setSearchParams(params);
  };

  const clearFilters = () => setSearchParams({});

  if (error) return <ErrorMessage error={error} />;
  if (!data) return <LoadingSpinner />;

  return (
    <div style={{ padding: '28px', fontFamily: "'Segoe UI', Tahoma, sans-serif" }}>
      <h1 style={{ fontSize: '20px', color: '#58a6ff', marginBottom: '4px' }}>
        Interceptions — Session #{id}
      </h1>
      <p style={{ fontSize: '12px', color: '#8b949e', marginBottom: '20px' }}>
        <Link to="/interceptions">← Sessions</Link>
        {session && (
          <>
            {' '}&nbsp;|&nbsp;{' '}
            <strong style={{ color: '#58a6ff' }}>{session.framework}</strong>
            {' '}&nbsp;
            <code>{session.browser_label}</code>
            {' '}&nbsp;|&nbsp; {session.started_at}
            {' '}&nbsp;|&nbsp; {session.action_count} actions &nbsp; {session.call_count} calls
          </>
        )}
      </p>

      <div style={{ display: 'flex', gap: '22px', alignItems: 'flex-start' }}>
        {/* Sidebar */}
        <div style={{ minWidth: '210px', maxWidth: '240px', flexShrink: 0 }}>
          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: '8px', padding: '13px', marginBottom: '13px' }}>
            <h2 style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#8b949e', marginBottom: '9px' }}>
              Top Functions
            </h2>
            {topFns.map(f => (
              <div
                key={f.fn_name}
                style={{ fontSize: '11px', fontFamily: 'monospace', color: '#c9d1d9', padding: '3px 0', borderBottom: '1px solid #21262d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <button
                  onClick={() => applyFilter(actionFilter, f.fn_name)}
                  title={`Filter by ${f.fn_name}`}
                  style={{ background: 'none', border: 'none', color: '#c9d1d9', fontFamily: 'monospace', fontSize: '11px', cursor: 'pointer', textAlign: 'left', padding: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '160px' }}
                >
                  {f.fn_name}
                </button>
                <span style={{ color: '#58a6ff', marginLeft: '4px', flexShrink: 0 }}>{f.cnt}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Main content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Filters */}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '14px', alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontSize: '11px', color: '#8b949e', marginBottom: '4px' }}>Filter by Action</div>
              <select
                value={actionFilter}
                onChange={e => applyFilter(e.target.value, fnFilter)}
                style={{ background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d', padding: '6px 10px', borderRadius: '6px', fontSize: '12px' }}
              >
                <option value="">All actions</option>
                {actions.map(a => (
                  <option key={a.action} value={a.action}>{a.action} ({a.cnt})</option>
                ))}
              </select>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: '#8b949e', marginBottom: '4px' }}>Filter by Function</div>
              <input
                type="text"
                value={fnFilter}
                onChange={e => applyFilter(actionFilter, e.target.value)}
                placeholder="e.g. addEventListener"
                style={{ background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d', padding: '6px 10px', borderRadius: '6px', fontSize: '12px', width: '200px' }}
              />
            </div>
            {(actionFilter || fnFilter) && (
              <button
                onClick={clearFilters}
                style={{ background: 'none', border: '1px solid #30363d', color: '#8b949e', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', alignSelf: 'flex-end' }}
              >
                Clear
              </button>
            )}
          </div>

          <p style={{ fontSize: '11px', color: '#6e7681', marginBottom: '10px' }}>
            {filteredCalls.length} call{filteredCalls.length !== 1 ? 's' : ''}
            {page > 0 ? ` (page ${page + 1} of ${totalPages})` : ''}
            {stacksOpen ? ' — stacks expanded' : ' — click ▸ to expand stack'}
          </p>

          {pageCalls.length === 0 ? (
            <p style={{ color: '#6e7681', padding: '16px', fontSize: '13px' }}>No results.</p>
          ) : (
            pageCalls.map(r => (
              <CallCard key={r.seq} row={r} sessionId={id} stacksOpen={stacksOpen} />
            ))
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ marginTop: '14px', display: 'flex', gap: '10px' }}>
              {page > 0 && (
                <button
                  onClick={() => setSearchParams({ ...Object.fromEntries(searchParams), page: page - 1 })}
                  style={{ background: '#21262d', border: '1px solid #30363d', color: '#58a6ff', padding: '5px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}
                >
                  ← Previous {PAGE_SIZE}
                </button>
              )}
              {page < totalPages - 1 && (
                <button
                  onClick={() => setSearchParams({ ...Object.fromEntries(searchParams), page: page + 1 })}
                  style={{ background: '#21262d', border: '1px solid #30363d', color: '#58a6ff', padding: '5px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}
                >
                  Next {PAGE_SIZE} →
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
