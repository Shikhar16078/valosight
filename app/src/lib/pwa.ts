import { useEffect, useState } from "react";

/**
 * Offline support for the web build: a service worker (app/pwa/sw.js) keeps a copy of the app
 * so it opens without a connection. It only stores the app's own files, never your data.
 */
export type OfflineState = "unsupported" | "preparing" | "ready";

const supported = () => import.meta.env.PROD && typeof navigator !== "undefined" && "serviceWorker" in navigator;

export function registerServiceWorker() {
  if (!supported()) return;
  const go = () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline support is a bonus; the app works without it */
    });
  };
  if (document.readyState === "complete") go();
  else window.addEventListener("load", go, { once: true });
}

/** "ready" once this release is saved on the device and the app no longer needs a connection. */
export function useOffline(): OfflineState {
  const [state, setState] = useState<OfflineState>(supported() ? "preparing" : "unsupported");
  useEffect(() => {
    if (!supported()) return;
    let live = true;
    navigator.serviceWorker.ready.then(() => {
      if (live) setState("ready");
    });
    return () => {
      live = false;
    };
  }, []);
  return state;
}
