import "./i18n"; // Initialize i18next before React renders
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./print.css";
import { installAppUpdateGuard } from "./lib/appUpdateGuard";
import { preloadDetectedLocale } from "./i18n/customLocales";

installAppUpdateGuard();

function render() {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

// A custom (admin-added) language is fetched before the first render, for at
// most a few seconds, so its user does not see English first. A built-in
// language resolves at once.
void preloadDetectedLocale().finally(render);
