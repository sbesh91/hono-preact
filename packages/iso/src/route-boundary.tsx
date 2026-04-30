import { Component } from 'preact';
import type { ComponentChildren, FunctionComponent, JSX } from 'preact';
import { Suspense } from 'preact/compat';

type ErrorFallback =
  | JSX.Element
  | ((error: Error, reset: () => void) => JSX.Element);

type ErrorBoundaryProps = {
  fallback?: ErrorFallback;
  children: ComponentChildren;
};

class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const f = this.props.fallback;
    if (typeof f === 'function') return f(error, this.reset);
    if (f) return f;
    return null;
  }
}

export const RouteBoundary: FunctionComponent<{
  fallback?: JSX.Element;
  errorFallback?: ErrorFallback;
  children: ComponentChildren;
}> = ({ fallback, errorFallback, children }) => (
  <ErrorBoundary fallback={errorFallback}>
    <Suspense fallback={fallback}>{children}</Suspense>
  </ErrorBoundary>
);
