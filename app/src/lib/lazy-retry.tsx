import { lazy, type ComponentProps, type ComponentType } from "react";

/**
 * `React.lazy` that can try again. Plain `lazy` remembers a failed download for good, so a page whose code
 * couldn't be fetched (offline, a network blip) would stay broken until a full reload. Here a failure swaps in a
 * fresh lazy component, so "Try again" or coming back to the page downloads it again.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyRetry<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  const make = () =>
    lazy(() =>
      load().catch((e) => {
        current = make();
        throw e;
      }),
    );
  let current = make();
  return function Retry(props: ComponentProps<T>) {
    const C = current;
    return <C {...props} />;
  };
}

/** A page's or chart's code couldn't be downloaded (rather than a bug in the page). */
export const isChunkError = (e: unknown) =>
  e instanceof Error && /dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch/i.test(e.message);
