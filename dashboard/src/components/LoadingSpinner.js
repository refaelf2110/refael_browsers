import React from 'react';

export default function LoadingSpinner({ message = 'Loading…' }) {
  return (
    <div style={{ padding: '48px 28px', textAlign: 'center', color: '#8b949e', fontSize: '14px' }}>
      <div
        style={{
          display: 'inline-block',
          width: '24px',
          height: '24px',
          border: '3px solid #30363d',
          borderTopColor: '#58a6ff',
          borderRadius: '50%',
          animation: 'spin 0.7s linear infinite',
          marginBottom: '12px',
        }}
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div>{message}</div>
    </div>
  );
}
