import { Component, type ErrorInfo, type ReactNode } from "react";
import { isChunkError } from "../lib/lazy-retry";

/** Keeps one broken page from blanking the whole app; remount it (via `key`) to retry. */
export class ErrorBoundary extends Component<{ children: ReactNode; onReset?: () => void }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Valosight page error:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="mx-auto max-w-[1400px] px-4 pt-10 sm:px-8">
        <div className="panel p-6">
          <h1 className="font-display text-2xl font-bold">{isChunkError(error) ? "This page couldn't be downloaded" : "This page couldn't be shown"}</h1>
          <p className="mt-2 text-muted">
            {isChunkError(error)
              ? "The app couldn't fetch this page's code. Check your connection and try again. Your vault is unchanged."
              : "Something in this account's data didn't look the way the page expected. Your vault is unchanged, and the other pages still work."}
          </p>
          <pre className="scroll-thin mt-3 overflow-x-auto rounded-lg bg-panel-2 p-3 font-mono text-[12px] text-muted">{error.message}</pre>
          <button
            onClick={() => {
              this.setState({ error: null });
              this.props.onReset?.();
            }}
            className="mt-4 rounded-lg border border-line px-3 py-1.5 text-[13px] hover:bg-panel-2"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
}
