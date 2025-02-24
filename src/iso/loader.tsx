import type { FunctionComponent } from "preact";
import { LocationHook, RouteHook } from "preact-iso";
import { Fragment, type JSX } from "preact/compat";
import { useHeadContext } from "./head.js";
import { isBrowser } from "./is-browser.js";
import { Page } from "./page.js";

export interface LoaderData<T> extends JSX.IntrinsicAttributes {
  id?: string;
  loaderData?: T;
  route?: string;
}

export type Loader<T> = (props: {
  route: RouteHook;
  location: LocationHook;
}) => Promise<T>;

interface LoaderProps<T> {
  serverLoader?: Loader<T>;
  clientLoader?: Loader<T>;
  Head?: FunctionComponent;
}

export const getLoaderData = <T extends {}>(
  Component: FunctionComponent<LoaderData<T>>,
  { serverLoader, clientLoader, Head = () => <Fragment /> }: LoaderProps<T> = {}
) => {
  return () => {
    const ctx = useHeadContext();

    if (!isBrowser()) {
      ctx.resolve(Head);
      // look into lazy loaded module timing between this and other suspense
    }

    return (
      <Page
        Child={Component}
        serverLoader={serverLoader}
        clientLoader={clientLoader}
        Head={Head}
      />
    );
  };
};
