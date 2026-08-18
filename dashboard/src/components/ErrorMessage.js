import React from 'react';

export default function ErrorMessage({ error }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div
      style={{
        margin: '28px',
        padding: '16px 20px',
        background: '#2d1117',
        border: '1px solid #8b1a1a',
        borderRadius: '8px',
        color: '#f85149',
        fontSize: '13px',
      }}
    >
      <strong>Error:</strong> {message}
    </div>
  );
}
