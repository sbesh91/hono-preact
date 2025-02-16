import { useSignal } from "@preact/signals";
import { FunctionComponent } from "preact";
import { LocationHook } from "preact-iso";
import { useEffect, useRef } from "preact/hooks";
import { isBrowser } from "./is-browser";
import { Loader, LoaderData } from "./loader";
import { deletePreloadedData, getPreloadedData } from "./preload";
import { useLocationData } from "./use-locaton";

interface ClientFetchProps<T> {
  Child: FunctionComponent<LoaderData<T>>;
  clientLoader: Loader<T>;
  id: string;
}

export function useClientFetch<T extends {}>({
  Child,
  clientLoader,
  id,
}: ClientFetchProps<T>) {
  const { location, route, routeMatch } = useLocationData({ Child });
  const inBrowser = isBrowser();
  const loading = useSignal(inBrowser);
  const prevLocation = useRef<LocationHook>();

  const loaderData = useSignal<T>();

  useEffect(() => {
    return () => {
      prevLocation.current = location;
      deletePreloadedData(id);
    };
  }, [location.url]);

  useEffect(() => {
    if (prevLocation.current?.url === location.url) {
      return;
    }
    const preloaded = getPreloadedData<T>(id);
    const isLoaded = Object.keys(preloaded).length > 0;

    if (!routeMatch || !inBrowser || isLoaded) return;

    loading.value = true;
    clientLoader({ route })
      .then((data) => {
        loaderData.value = data;
        deletePreloadedData(id);
      })
      .catch(console.log)
      .finally(() => {
        loading.value = false;
      });
  }, [routeMatch, location.url, inBrowser, clientLoader]);

  return { loading, loaderData };
}
