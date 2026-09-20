import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { StartupApp } from "./StartupApp";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("PRMONITOR_RENDERER_ROOT_MISSING");
}

createRoot(rootElement).render(
  <StrictMode>
    <StartupApp />
  </StrictMode>,
);
