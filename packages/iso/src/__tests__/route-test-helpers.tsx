// Shared helpers for the routing tests. Lives under __tests__/ (excluded from
// tsc and not matched by the `*.test.*` runner glob), so it is neither
// type-checked nor executed as a suite.
import { useLocation } from 'preact-iso';

/**
 * Capture preact-iso's `route()` navigator so a test body can drive navigations
 * imperatively. Render `<Capture/>` inside a `<LocationProvider>`, then call
 * `nav(to)` after the initial render. Replaces the verbatim
 * `let nav!: ...; const Controller = () => { nav = useLocation().route; ... }`
 * idiom that was copy-pasted across the routing tests.
 */
export function createRouteCapture(): {
  Capture: () => null;
  nav: (to: string) => void;
} {
  let route: (to: string) => void = () => {};
  const Capture = () => {
    route = useLocation().route;
    return null;
  };
  return { Capture, nav: (to: string) => route(to) };
}
