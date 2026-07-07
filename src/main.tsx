import React from "react";
import ReactDOM from "react-dom/client";
// Must run before the editor renders so Monaco uses the local (offline) build.
import "./monaco-setup";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
