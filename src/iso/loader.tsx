import type { FunctionComponent } from "preact";
import { RouteHook } from "preact-iso";
import { type JSX } from "preact/compat";
import { Page } from "./page.js";

export interface LoaderData<T> extends JSX.IntrinsicAttributes {
  id?: string;
  loaderData?: T;
  route?: string;
}

export type Loader<T> = (props: { route: RouteHook }) => Promise<T>;

export const getLoaderData = <T extends {}>(
  Component: FunctionComponent<LoaderData<T>>,
  serverLoader: Loader<T>,
  clientLoader: Loader<T> = serverLoader
) => {
  return () => {
    return (
      <Page
        Child={Component}
        serverLoader={serverLoader}
        clientLoader={clientLoader}
      />
    );
  };
};
