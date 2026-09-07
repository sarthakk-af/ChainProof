/**
 * ErrorBoundary.jsx — Catches a render-time crash anywhere below it.
 *
 * Without this, a bug in any screen (a null reference, a bad API response
 * shape, anything) turns the whole app into a blank white page with no
 * explanation. React only supports this via a class component — there's no
 * hook equivalent — so this is the one place in the app that isn't hooks.
 */

import React from "react";

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("[ErrorBoundary] Caught a render error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="page-container animate-fade-in-up text-center" style={{ maxWidth: 480, marginTop: 100 }}>
          <div style={{ fontSize: "3rem", marginBottom: 16 }}>⚠️</div>
          <h2 style={{ marginBottom: 12 }}>Something went wrong</h2>
          <p style={{ marginBottom: 24 }}>
            This screen hit an unexpected error. Reloading usually fixes it — if it keeps
            happening, that's worth reporting.
          </p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            🔄 Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
