import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "./components/AppShell";
import { ModelSettingsPage } from "./features/ModelSettingsPage";
import { SpacesPage } from "./features/SpacesPage";
import { WorkspacePage } from "./features/WorkspacePage";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<SpacesPage />} />
          <Route path="/settings/models" element={<ModelSettingsPage />} />
          <Route path="/spaces/:spaceId/:section?" element={<WorkspacePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
