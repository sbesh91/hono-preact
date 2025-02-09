import type { FunctionComponent } from "preact";
import { lazy, type JSX } from "preact/compat";

export interface LoaderData<T> extends JSX.IntrinsicAttributes {
  loaderData?: T;
}

export const getLoaderData = <T,>(
  Component: FunctionComponent<LoaderData<T>>,
  loader: () => Promise<T>
) =>
  lazy(() =>
    loader().then((props) => {
      const data = { loaderData: props };
      return { default: () => <Component {...data} /> };
    })
  );
