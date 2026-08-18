import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Nav from './components/Nav';
import Dashboard from './pages/Dashboard';
import RunDetail from './pages/RunDetail';
import Diff from './pages/Diff';
import CanIRun from './pages/CanIRun';
import Interceptions from './pages/Interceptions';
import InterceptionDetail from './pages/InterceptionDetail';

export default function App() {
  return (
    <BrowserRouter>
      <Nav />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/run/:id" element={<RunDetail />} />
        <Route path="/diff" element={<Diff />} />
        <Route path="/canirun" element={<CanIRun />} />
        <Route path="/interceptions" element={<Interceptions />} />
        <Route path="/interceptions/:id" element={<InterceptionDetail />} />
      </Routes>
    </BrowserRouter>
  );
}
