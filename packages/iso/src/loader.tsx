import { type FunctionComponent, type JSX } from 'preact';
import { RouteHook } from 'preact-iso';
import { memo } from 'preact/compat';
import { type GuardFn } from './guard.js';
import { LoaderCache } from './cache.js';
import { Page } from './page.js';

export interface LoaderData<T> extends JSX.IntrinsicAttributes {
  id?: string;
  loaderData?: T;
  route?: string;
}

export type Loader<T> = (props: { location: RouteHook }) => Promise<T>;

interface LoaderProps<T> {
  serverLoader?: Loader<T>;
  clientLoader?: Loader<T>;
  cache?: LoaderCache<T>;
  serverGuards?: GuardFn[];
  clientGuards?: GuardFn[];
  fallback?: JSX.Element;
}

export const getLoaderData = <T extends {}>(
  Component: FunctionComponent<LoaderData<T>>,
  { serverLoader, clientLoader, cache, serverGuards, clientGuards, fallback }: LoaderProps<T> = {}
) => {
  return memo((location: RouteHook) => {
    return (
      <Page
        Child={Component}
        serverLoader={serverLoader}
        clientLoader={clientLoader}
        location={location}
        cache={cache}
        serverGuards={serverGuards}
        clientGuards={clientGuards}
        fallback={fallback}
      />
    );
  });
};

export { useReload } from './page.js';
