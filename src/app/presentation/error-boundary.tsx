"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button, Card } from "./ui";

interface ErrorBoundaryProps {
  readonly children: ReactNode;
  readonly title?: string;
  readonly onError?: (error: Error, info: ErrorInfo) => void;
  /**
   * Identity of the content this boundary is guarding. A boundary mounted in a
   * PERSISTENT host (an App Router layout is reconciled by position, so only
   * `children` is swapped on a client-side navigation) would otherwise hold a
   * caught error across every later destination: one failed view would leave the
   * whole section showing the fallback over content that is perfectly healthy.
   * A host that swaps content passes what identifies it, and the caught error is
   * released when it changes.
   */
  readonly resetKey?: string | number;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  /**
   * The boundary wraps every authenticated page, so a caught failure that goes nowhere
   * leaves a production incident with no record of what broke. Absent a host-supplied
   * reporter this records to the browser console - the surface the no-console fence
   * sanctions for a client boundary (ADR-0013) - and never to the user-facing card.
   */
  override componentDidCatch(error: Error, info: ErrorInfo) {
    if (this.props.onError) {
      this.props.onError(error, info);
      return;
    }
    console.error("ErrorBoundary caught a render failure", error, info.componentStack ?? "");
  }

  override componentDidUpdate(previous: ErrorBoundaryProps) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  private readonly retry = () => {
    this.setState({ error: null });
  };

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <Card role="alert" className="flex flex-col items-start gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{this.props.title ?? "This view could not be shown."}</h2>
          <p className="mt-1 text-sm text-slate-600">Try this view again. If the problem continues, return to the previous page.</p>
        </div>
        <Button type="button" onClick={this.retry}>Try again</Button>
      </Card>
    );
  }
}
