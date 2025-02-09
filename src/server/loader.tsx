import type { FunctionComponent } from "preact";
import { lazy, type JSX } from "preact/compat";

interface LoaderData<T> extends JSX.IntrinsicAttributes {
  loaderData: T;
}

export const getLoaderData = <T,>(
  Component: FunctionComponent<LoaderData<T>>,
  loader: () => Promise<T>
) => {
  const loaded = lazy(() =>
    loader().then((props) => {
      const data = {
        loaderData: props,
      };
      return { default: <Component {...data} /> };
    })
  );

  return loaded;
};
