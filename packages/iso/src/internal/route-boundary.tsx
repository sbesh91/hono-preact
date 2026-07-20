import { Component, options } from 'preact';
import type { ComponentChildren, FunctionComponent } from 'preact';
import { isOutcome } from '../outcomes.js';
import type { DenyOutcome } from '../outcomes.js';
import { isBrowser } from '../is-browser.js';
import { isLoaderDeny } from './loader-deny-mark.js';
import { recordServerDeny } from './server-deny-registry.js';
import { toError } from './to-error.js';

// `preact-render-to-string` reads this flag off preact's own global `options`
// object; it is not part of preact's typed `Options` interface (the flag is
// preact-render-to-string's convention, not preact's), so declare it here
// rather than reading/writing it through a cast.
declare module 'preact' {
  interface Options {
    errorBoundaries?: boolean;
  }
}

// `preact-render-to-string` only invokes `getDerivedStateFromError` /
// `componentDidCatch` during a string render when this flag is set (its own
// README documents it as an explicit opt-in); nothing else in this codebase
// sets it. Without it, `ErrorBoundary` below is dead code on the server: a
// thrown loader error or tagged deny would unwind straight past every class
// component and out of `renderToStringAsync`, never reaching an
// `errorFallback`. Setting it here, at the module that owns the only
// error-boundary class in the tree, guarantees it is set before any render
// that could use one. It is a `preact` global, not a `preact-render-to-string`
// call, so it has no effect on the browser's DOM-diffing render path (which
// has always supported error boundaries natively, flag or not).
options.errorBoundaries = true;

type ErrorFallback =
  | ComponentChildren
  | ((error: Error, reset: () => void) => ComponentChildren);

type ErrorBoundaryProps = {
  fallback?: ErrorFallback;
  children: ComponentChildren;
};

type ErrorBoundaryState = { error: Error | null; deny: DenyOutcome | null };

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null, deny: null };

  // Outcomes are control-flow, not errors. A SERVER-side, loader-tagged deny is
  // the one exception we may render (as the route's errorFallback at the deny
  // status); render() decides based on whether a fallback exists. Everything
  // else - the client, a redirect/render outcome, or an untagged middleware
  // deny - rethrows so renderPage's outer catch translates it (a middleware
  // deny stays bare text, matching the client where it never reaches a
  // fallback). The same guard lives in componentDidCatch because Preact may
  // invoke both hooks; whichever fires first must not swallow.
  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    if (isOutcome(error)) {
      if (!isBrowser() && isLoaderDeny(error)) {
        // `error` is already narrowed to `DenyOutcome`, whose `.message` is a
        // typed string: build the `Error` straight from it rather than
        // routing through `toError`, which normalizes an arbitrary `unknown`
        // via `String(err)` and would flatten a plain deny object to
        // "[object Object]".
        return { error: new Error(error.message), deny: error };
      }
      throw error;
    }
    return { error: toError(error), deny: null };
  }

  componentDidCatch(error: unknown) {
    if (isOutcome(error) && !(!isBrowser() && isLoaderDeny(error))) throw error;
  }

  reset = () => {
    this.setState({ error: null, deny: null });
  };

  render() {
    const { error, deny } = this.state;
    if (!error) return this.props.children;
    const f = this.props.fallback;
    if (deny) {
      // No fallback here: unwind to an outer boundary (which may have one).
      if (f == null) throw deny;
      // Record the response facts so renderPage sets the document status.
      recordServerDeny({ status: deny.status, headers: deny.headers });
    }
    // Server: a caught error with no fallback must propagate so renderPage /
    // Hono surface the failure (a 500), matching the behavior before server
    // error boundaries were enabled. Rendering null here would silently ship a
    // blank 200. On the client, a fallback-less boundary keeps rendering null
    // (its long-standing behavior).
    if (f == null && !isBrowser()) throw error;
    if (typeof f === 'function') return f(error, this.reset);
    if (f) return f;
    return null;
  }
}

export const RouteBoundary: FunctionComponent<{
  errorFallback?: ErrorFallback;
  children: ComponentChildren;
}> = ({ errorFallback, children }) => (
  <ErrorBoundary fallback={errorFallback}>{children}</ErrorBoundary>
);
