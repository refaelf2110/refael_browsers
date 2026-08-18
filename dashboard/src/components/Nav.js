import React from 'react';
import { Link, useLocation } from 'react-router-dom';

const navStyle = {
  background: '#161b22',
  borderBottom: '1px solid #30363d',
  padding: '0 28px',
  display: 'flex',
  alignItems: 'center',
  gap: '24px',
  height: '48px',
};

const logoStyle = {
  color: '#58a6ff',
  fontWeight: 700,
  fontSize: '15px',
  textDecoration: 'none',
  marginRight: '8px',
};

function NavLink({ to, children, color }) {
  const location = useLocation();
  const active = location.pathname === to || (to !== '/' && location.pathname.startsWith(to));
  return (
    <Link
      to={to}
      style={{
        color: active ? (color || '#58a6ff') : '#8b949e',
        textDecoration: 'none',
        fontSize: '13px',
        fontWeight: active ? 600 : 400,
        borderBottom: active ? `2px solid ${color || '#58a6ff'}` : '2px solid transparent',
        paddingBottom: '2px',
        transition: 'color 0.15s',
      }}
    >
      {children}
    </Link>
  );
}

export default function Nav() {
  return (
    <nav style={navStyle}>
      <Link to="/" style={logoStyle}>Browser Detection Matrix</Link>
      <NavLink to="/">Dashboard</NavLink>
      <NavLink to="/diff">Property Diff</NavLink>
      <NavLink to="/canirun">Can I Run</NavLink>
      <NavLink to="/interceptions" color="#f0883e">Interceptions</NavLink>
      <NavLink to="/browsers" color="#3fb950">Run Browsers</NavLink>
    </nav>
  );
}
