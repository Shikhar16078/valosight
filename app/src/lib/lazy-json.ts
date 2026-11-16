/**
 * A same-origin JSON file (the game data under /game/) loaded once, on first use, and shared by every component.
 * Three states, so a view can tell them apart: `undefined` while loading, `null` when it isn't available (missing
 * file, offline, bad JSON; tried again on the next use), or the built value.
 */
import { useEffect, useState } from "react";

export function lazyJson<Raw, T>(url: string, build: (raw: Raw) => T | null, onLoad?: (value: T) => void) {
  let value: T | null | undefined; // undefined = not loaded yet
  let loading: Promise<T | null> | null = null;
  const load = () =>
    (loading ??= fetch(__GAME_VERSION__ ? `${url}?v=${__GAME_VERSION__}` : url) // versioned: cached for good (vite.config.ts)
      .then((r) => {
        // The dev server answers a missing file with index.html (200), so check it's JSON.
        if (!r.ok || !/json/.test(r.headers.get("content-type") ?? "")) return null;
        return r.json() as Promise<Raw>;
      })
      .then((raw) => (raw && typeof raw === "object" ? build(raw) : null))
      .catch(() => null)
      .then((v) => {
        value = v;
        if (v) onLoad?.(v);
        else loading = null; // not available: try again next time (e.g. back online)
        return v;
      }));

  /** The value once `enabled`: undefined while loading, null when unavailable. `.preload()` starts loading now
   *  (e.g. at boot) without waiting for a component to ask. */
  return Object.assign(function useLazyJson(enabled = true): T | null | undefined {
    const [v, setV] = useState(value);
    useEffect(() => {
      if (!enabled) return;
      if (value) {
        setV(value); // loaded meanwhile (e.g. by another view, or while this one was disabled)
        return;
      }
      let live = true;
      setV(undefined);
      load().then((x) => {
        if (live) setV(x);
      });
      return () => {
        live = false;
      };
    }, [enabled]);
    return v;
  }, {
    preload: () => {
      if (!value) void load();
    },
  });
}
