import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { registerServiceWorker } from "./lib/pwa";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();

// Focus rings are for keyboard users. Browsers sometimes still draw one after a mouse click (e.g. after any
// key press, like a screenshot shortcut), so track how the person is actually interacting.
const root = document.documentElement;
addEventListener("pointerdown", () => { root.dataset.input = "mouse"; }, true);
addEventListener("keydown", (e) => { if (!e.metaKey && !e.ctrlKey && !e.altKey && /^(Tab|Arrow|Enter| |Escape|Home|End|Page)/.test(e.key)) root.dataset.input = "keyboard"; }, true);
