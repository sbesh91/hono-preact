import { type FunctionComponent, type JSX } from 'preact';
import { LocationHook } from 'preact-iso';
import { memo } from 'preact/compat';
import { LoaderCache } from './cache.js';
import { Page } from './page.js';

export interface LoaderData<T> extends JSX.IntrinsicAttributes {
  id?: string;
  loaderData?: T;
  route?: string;
}

export type Loader<T> = (props: { location: LocationHook }) => Promise<T>;

interface LoaderProps<T> {
  serverLoader?: Loader<T>;
  clientLoader?: Loader<T>;
  cache?: LoaderCache<T>;
}

export const getLoaderData = <T extends {}>(
  Component: FunctionComponent<LoaderData<T>>,
  { serverLoader, clientLoader, cache }: LoaderProps<T> = {}
) => {
  return memo((location: LocationHook) => {
    return (
      <Page
        Child={Component}
        serverLoader={serverLoader}
        clientLoader={clientLoader}
        location={location}
        cache={cache}
      />
    );
  });
};
