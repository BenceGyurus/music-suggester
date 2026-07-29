import React from 'react';
import { BrowserRouter as Router, Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import Settings from './components/Settings';

function App() {
  return (
    <Router>
      <div className="app-container">
        <nav className="nav-bar">
          <div className="nav-brand">AI Music Suggester</div>
          <div className="nav-links">
            <NavLink to="/" className={({isActive}) => isActive ? "active" : ""}>Dashboard</NavLink>
            <NavLink to="/settings" className={({isActive}) => isActive ? "active" : ""}>Settings</NavLink>
          </div>
        </nav>

        <main>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
