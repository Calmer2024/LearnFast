import { Link, Outlet } from "react-router-dom";

import { SystemConsole } from "./SystemConsole";

export function AppShell() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" to="/">
          LearnFast
        </Link>
        <nav className="topbar-actions">
          <Link to="/">学习空间</Link>
          <Link to="/settings/models">模型设置</Link>
        </nav>
      </header>
      <Outlet />
      <SystemConsole />
    </div>
  );
}
