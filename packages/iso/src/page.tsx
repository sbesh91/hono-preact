import type {
  ComponentChildren,
  ComponentType,
  FunctionComponent,
  JSX,
} from 'preact';
import { useId } from 'preact/hooks';
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
  errorFallback?:
    | JSX.Element
    | ((error: Error, reset: () => void) => JSX.Element);
  Wrapper?: ComponentType<WrapperProps>;
  children: ComponentChildren;
};

export function Page({
  errorFallback,
  Wrapper,
  children,
}: PageProps): JSX.Element {
  const id = useId();
  const W = Wrapper ?? DefaultWrapper;
  return (
    <RouteBoundary errorFallback={errorFallback}>
      <W id={id} data-loader="null">
        {children}
      </W>
    </RouteBoundary>
  );
}
