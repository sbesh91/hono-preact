import { Component } from 'preact';
import type { ComponentChildren, FunctionComponent, JSX } from 'preact';
import { Suspense } from 'preact/compat';
import { isOutcome } from '../outcomes.js';

type ErrorFallback =
  | JSX.Element
  | ((error: Error, reset: () => void) => JSX.Element);

type ErrorBoundaryProps = {
  fallback?: ErrorFallback;
  children: ComponentChildren;
};

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  { error: Error | null }
> {
  state = { error: null as Error | null };

  // Outcomes (redirect/deny/render) are NOT errors; they are control-flow
  // signals that the dispatcher / renderPage outer catch is responsible for
  // translating. If RouteBoundary swallowed them here, every page-scope
  // throw from `PageMiddlewareHost` (HostConsumer rethrowing a deny on SSR,
  // for example) would be coerced into `new Error(String(outcome))` and
  // surfaced as the fallback UI, with no 302 / 403 / etc. reaching the
  // network. Re-throw outcomes so the outer handler sees them. The same
  // guard lives in `componentDidCatch` because Preact invokes both hooks
  // when the boundary catches; whichever fires first must not swallow.
  static getDerivedStateFromError(error: unknown) {
    if (isOutcome(error)) throw error;
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown) {
    if (isOutcome(error)) throw error;
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
