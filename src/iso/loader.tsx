import type { FunctionComponent } from "preact";
import { lazy, useId, type JSX } from "preact/compat";
import { isBrowser } from "./is-browser.js";
import { Page } from "./page.js";

export interface LoaderData<T> extends JSX.IntrinsicAttributes {
  id?: string;
  loaderData?: T;
}

export const getLoaderData = <T extends {}>(
  Component: FunctionComponent<LoaderData<T>>,
  serverLoader: () => Promise<T>,
  clientLoader: () => Promise<T> = serverLoader
): FunctionComponent => {
  return lazy(async () => {
    const id = useId();
    const loader = !isBrowser() ? serverLoader : clientLoader;
    const preloaded = getPreloadedData<T>(id);
    const isEmpty = Object.keys(preloaded).length === 0;

    const props = isEmpty ? await loader() : preloaded;
    return {
      default: () => <Page id={id} loaderData={props} Child={Component} />,
    };
  });
};

function getPreloadedData<T>(id: string) {
  const defaultValue = {} as T;
  if (!isBrowser()) {
    return defaultValue;
  }

  const el = document.getElementById(id);
  if (!el) {
    return defaultValue;
  }

  try {
    return JSON.parse(el.dataset.loader ?? "{}") as T;
  } catch (error) {
    return defaultValue;
  } finally {
    delete el.dataset.loader;
  }
}
