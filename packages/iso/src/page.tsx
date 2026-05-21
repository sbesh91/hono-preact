import type {
  ComponentChildren,
  ComponentType,
  FunctionComponent,
  JSX,
} from 'preact';
import { useId } from 'preact/hooks';
import type { RouteHook } from 'preact-iso';
import type { PageUse } from './internal/use-types.js';
import { PageMiddlewareHost } from './internal/page-middleware-host.js';
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
  use?: PageUse;
  errorFallback?:
    | JSX.Element
    | ((error: Error, reset: () => void) => JSX.Element);
  Wrapper?: ComponentType<WrapperProps>;
  children: ComponentChildren;
};

export function Page({
  location,
  use,
  errorFallback,
  Wrapper,
  children,
}: PageProps): JSX.Element {
  const id = useId();
  const W = Wrapper ?? DefaultWrapper;
  return (
    <RouteBoundary errorFallback={errorFallback}>
      <PageMiddlewareHost use={use} location={location}>
        <W id={id} data-loader="null">
          {children}
        </W>
      </PageMiddlewareHost>
    </RouteBoundary>
  );
}
