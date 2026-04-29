import type { ComponentChildren, FunctionComponent, JSX } from 'preact';
import { Suspense } from 'preact/compat';

export const RouteBoundary: FunctionComponent<{
  fallback?: JSX.Element;
  children: ComponentChildren;
}> = ({ fallback, children }) => (
  <Suspense fallback={fallback}>{children}</Suspense>
);
