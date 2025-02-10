import type { FunctionComponent } from "preact";
import { lazy, type JSX } from "preact/compat";
import { context } from "../server/context.js";

export interface LoaderData<T> extends JSX.IntrinsicAttributes {
  loaderData?: T;
}

export const getLoaderData = <T,>(
  Component: FunctionComponent<LoaderData<T>>,
  serverLoader: () => Promise<T>,
  clientLoader: () => Promise<T> = serverLoader
): FunctionComponent => {
  return lazy(async () => {
    const loader = context.value ? serverLoader : clientLoader;

    if (!loader) {
      return Promise.resolve({
        default: () => <Component />,
      });
    }

    const props = await loader();
    const data = { loaderData: props, location };
    return { default: () => <Component {...data} /> };
  });
};
