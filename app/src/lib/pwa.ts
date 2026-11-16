import { useEffect, useState } from "react";

/**
 * Offline support for the web build: a service worker (app/pwa/sw.js) keeps a copy of the app
 * so it opens without a connection. It only stores the app's own files and the item pictures you've looked at
 * (public game art), never your data.
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
  // After load and once the browser is idle, so saving the offline copy never competes with the first screen
  // (its pictures, the game data). Browsers without requestIdleCallback wait a few seconds instead.
  const later = () => {
    if ("requestIdleCallback" in window) window.requestIdleCallback(go, { timeout: 4000 });
    else setTimeout(go, 3000);
  };
  if (document.readyState === "complete") later();
  else window.addEventListener("load", later, { once: true });
}

/** The service worker's store of item pictures (pwa/sw.js): public game art, but it shows which items were viewed. */
const MEDIA_CACHE = "valosight-media";

/** Forget the saved item pictures: when the user removes their data, restores a backup or turns pictures off. */
export function clearPictureCache() {
  if (typeof window === "undefined" || !("caches" in window)) return;
  // The service worker also clears it, so a picture it is saving right now doesn't bring the cache back.
  navigator.serviceWorker?.controller?.postMessage("clear-media");
  caches.delete(MEDIA_CACHE).catch(() => {
    /* nothing saved, or storage unavailable */
  });
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
