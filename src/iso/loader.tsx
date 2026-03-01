import type { FunctionComponent } from 'preact';
import { LocationHook } from 'preact-iso';
import { Fragment, memo, type JSX } from 'preact/compat';
import { LoaderCache } from './cache.js';
import { useHeadContext } from './head.js';
import { isBrowser } from './is-browser.js';
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
  Head?: FunctionComponent;
  cache?: LoaderCache<T>;
}

export const getLoaderData = <T extends {}>(
  Component: FunctionComponent<LoaderData<T>>,
  { serverLoader, clientLoader, Head = () => <Fragment />, cache }: LoaderProps<T> = {}
) => {
  return memo((location: LocationHook) => {
    const ctx = useHeadContext();

    if (!isBrowser()) {
      ctx.headSignal.value = Head;
    }

    return (
      <Page
        Child={Component}
        serverLoader={serverLoader}
        clientLoader={clientLoader}
        Head={Head}
        location={location}
        cache={cache}
      />
    );
  });
};
