import type { FunctionComponent } from "preact";
import { lazy, type JSX } from "preact/compat";
import { isBrowser } from "./is-browser.js";

export interface LoaderData<T> extends JSX.IntrinsicAttributes {
  loaderData?: T;
}

export const getLoaderData = <T,>(
  Component: FunctionComponent<LoaderData<T>>,
  serverLoader: () => Promise<T>,
  clientLoader: () => Promise<T> = serverLoader
): FunctionComponent => {
  return lazy(async () => {
    const loader = !isBrowser() ? serverLoader : clientLoader;

    const props = await loader();
    const data = { loaderData: props };
    return { default: () => <Component {...data} /> };
  });
};
