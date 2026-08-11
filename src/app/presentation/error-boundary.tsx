"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button, Card } from "./ui";

interface ErrorBoundaryProps {
  readonly children: ReactNode;
  readonly title?: string;
  readonly onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info);
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
