import "./i18n"; // Initialize i18next before React renders
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./print.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
