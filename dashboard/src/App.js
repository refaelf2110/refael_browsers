import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Nav from './components/Nav';
import Dashboard from './pages/Dashboard';
import Results from './pages/Results';
import RunDetail from './pages/RunDetail';
import Diff from './pages/Diff';
import CanIRun from './pages/CanIRun';
import Interceptions from './pages/Interceptions';
import InterceptionDetail from './pages/InterceptionDetail';
import Browsers from './pages/Browsers';
import BrowserDownload from './pages/BrowserDownload';

export default function App() {
  return (
    <BrowserRouter>
      <Nav />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/results" element={<Results />} />
        <Route path="/run/:id" element={<RunDetail />} />
        <Route path="/diff" element={<Diff />} />
        <Route path="/canirun" element={<CanIRun />} />
        <Route path="/interceptions" element={<Interceptions />} />
        <Route path="/interceptions/:id" element={<InterceptionDetail />} />
        <Route path="/browsers" element={<Browsers />} />
        <Route path="/browsers/new" element={<BrowserDownload />} />
      </Routes>
    </BrowserRouter>
  );
}
