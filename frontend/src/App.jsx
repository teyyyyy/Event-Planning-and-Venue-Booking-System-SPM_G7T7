import React from 'react';
import { useAuth } from './AuthContext';
import Login from './Login';

const sidebarStyles = `.app-shell{padding:0;min-height:100dvh;background:#dfeeff}.sidebar{width:238px;flex-shrink:0;padding:34px 25px 28px;background:#cfe3fa;border:0}.sidebar-divider{display:none}.page-content{min-height:100dvh;display:flex;flex:1;flex-direction:column;padding:0;border:0}.page-content .site-header{height:76px;padding:0 5.5vw;display:flex;align-items:center;justify-content:space-between;border:0;background:rgba(245,249,255,.72)}.page-title{margin:0;color:#193452;font-size:20px;font-weight:600;letter-spacing:-.03em}.header-user{display:flex;align-items:center;gap:14px;color:#193452;font-size:13px}.header-user .user-name{color:#4a5b74}.logout-btn{border:1px solid #b9cbe4;background:transparent;border-radius:999px;padding:9px 16px;color:#193452;font:inherit;cursor:pointer}.logout-btn:hover{background:rgba(255,255,255,.6)}.hero,.site-footer{display:none}@media(max-width:700px){.sidebar{width:180px;padding:24px 18px 22px}.page-content .site-header{height:68px;padding:0 24px}}@media(max-width:480px){.sidebar{width:72px;padding:24px 12px}.page-title{font-size:16px}.header-user .user-name{display:none}}`;

function Dashboard() {
  const { user, logout } = useAuth();
  return (
    <>
      <style>{sidebarStyles}</style>
      <main className="app-shell">
        <aside className="sidebar">
          <a className="brand" href="/" aria-label="Home">
            <span className="brand-mark">G</span>
          </a>
          <div className="sidebar-divider" />
        </aside>
        <div className="page-content">
          <header className="site-header">
            <h1 className="page-title">Event Management</h1>
            <div className="header-user">
              <span className="user-name">{user.name}</span>
              <button type="button" className="logout-btn" onClick={logout}>
                Log out
              </button>
            </div>
          </header>
          <section className="hero" />
          <footer className="site-footer" />
        </div>
      </main>
    </>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="auth-screen">
        <p className="auth-loading">Loading…</p>
      </div>
    );
  }

  return user ? <Dashboard /> : <Login />;
}
