import type {
  ComponentChildren,
  ComponentType,
  FunctionComponent,
  JSX,
} from 'preact';
import { useId } from 'preact/hooks';
import type { RouteHook } from 'preact-iso';
import type { GuardFn } from './guard.js';
import type { PageUse } from './internal/use-types.js';
import { Guards } from './internal/guards.js';
import { RouteBoundary } from './internal/route-boundary.js';

export type WrapperProps = {
  id: string;
  'data-loader': string;
  children: ComponentChildren;
};

const DefaultWrapper: FunctionComponent<WrapperProps> = (props) => (
  <section {...props} />
);

export type PageProps = {
  location: RouteHook;
  guards?: GuardFn[];
  /**
   * Page-scope middleware/observer list. Accepted now but not wired until
   * Task 25 swaps Guards for PageMiddlewareHost; until then, `guards` is the
   * runtime path.
   */
  use?: PageUse;
  errorFallback?:
    | JSX.Element
    | ((error: Error, reset: () => void) => JSX.Element);
  Wrapper?: ComponentType<WrapperProps>;
  children: ComponentChildren;
};

export function Page({
  location,
  guards,
  use: _use,
  errorFallback,
  Wrapper,
  children,
}: PageProps): JSX.Element {
  const id = useId();
  const W = Wrapper ?? DefaultWrapper;
  return (
    <RouteBoundary errorFallback={errorFallback}>
      <Guards guards={guards} location={location}>
        <W id={id} data-loader="null">
          {children}
        </W>
      </Guards>
    </RouteBoundary>
  );
}
