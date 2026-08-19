import { Component, type ReactNode } from "react";

interface ErrorBoundaryState { hasError: boolean; }

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError() { return { hasError: true }; }

  componentDidCatch() {
    // Deliberately avoid sending user content or stack traces to third parties.
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return <main className="theme-page-home flex min-h-screen items-center justify-center p-6">
      <section className="theme-panel max-w-md rounded-2xl border p-7 text-center shadow-panel">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-300">Something went wrong</p>
        <h1 className="mt-3 font-display text-3xl theme-text-primary">Code Collaborator needs a refresh</h1>
        <p className="mt-3 text-sm theme-text-muted">Your room data remains on the server. Reload the page to reconnect safely.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3"><button type="button" className="theme-button-primary rounded-xl px-4 py-2.5" onClick={() => window.location.reload()}>Reload</button><button type="button" className="theme-button-neutral rounded-xl border px-4 py-2.5" onClick={() => window.location.assign("/")}>Go home</button></div>
      </section>
    </main>;
  }
}
