import { Books, GearSix } from "@phosphor-icons/react";
import { Link, Outlet, useLocation } from "react-router-dom";

import { SystemConsole } from "./SystemConsole";

export function AppShell() {
  const location = useLocation();
  const spacesActive = location.pathname === "/" || location.pathname.startsWith("/spaces");
  const settingsActive = location.pathname.startsWith("/settings");

  return (
    <div className="app-shell">
      <aside className="nav-rail" aria-label="工具导航">
        <Link className="brand-mark" to="/" title="LearnFast" aria-label="LearnFast 首页">
          LF
        </Link>
        <nav className="rail-nav" aria-label="主导航">
          <Link
            aria-label="学习空间"
            className={`rail-button ${spacesActive ? "active" : ""}`}
            title="学习空间"
            to="/"
          >
            <Books size={19} weight={spacesActive ? "fill" : "regular"} />
          </Link>
          <Link
            aria-label="模型设置"
            className={`rail-button ${settingsActive ? "active" : ""}`}
            title="模型设置"
            to="/settings/models"
          >
            <GearSix size={19} weight={settingsActive ? "fill" : "regular"} />
          </Link>
        </nav>
      </aside>
      <section className="app-workspace" aria-label="LearnFast 工作区">
        <Outlet />
      </section>
      <SystemConsole />
    </div>
  );
}
