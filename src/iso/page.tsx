import { Signal, useSignal } from "@preact/signals";
import { FunctionComponent } from "preact";
import { useRoute } from "preact-iso";
import { exec, LocationHook, useLocation } from "preact-iso/router";
import { memo, Suspense, useEffect, useId, useRef } from "preact/compat";
import { isBrowser } from "./is-browser";
import { Loader, LoaderData } from "./loader";
import { deletePreloadedData, getPreloadedData } from "./preload";
import wrapPromise from "./wrap-promise";

type PageProps<T> = LoaderData<T> & {
  Child: FunctionComponent<LoaderData<T>>;
  serverLoader: Loader<T>;
  clientLoader: Loader<T>;
};

export const Page = memo(function <T extends {}>({
  Child,
  serverLoader,
  clientLoader,
}: PageProps<T>) {
  const id = useId();

  const location = useLocation();
  const prevLocation = useRef<LocationHook>();
  const route = useRoute();
  const loaderData = useSignal<T>();
  const routeMatch =
    exec(location.url, Child.defaultProps?.route ?? "") !== undefined;

  const preloaded = getPreloadedData<T>(id);
  const isLoaded = Object.keys(preloaded).length > 0;

  const inBrowser = isBrowser();
  const loading = useSignal(inBrowser);

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
  }, [routeMatch, location.url, inBrowser]);

  if (!routeMatch) {
    return null;
  }

  if (loaderData.value) {
    return (
      <Helper
        id={id}
        Child={Child}
        loader={{ read: () => loaderData.value }}
        loading={loading}
      />
    );
  }

  if (isLoaded) {
    return (
      <Helper
        id={id}
        Child={Child}
        loader={{ read: () => preloaded }}
        loading={loading}
      />
    );
  }

  if (loading.value) {
    return null;
  }

  const loader = () => wrapPromise(serverLoader({ route }));

  return (
    <Suspense fallback={null}>
      <Helper id={id} Child={Child} loader={loader()} loading={loading} />
    </Suspense>
  );
});

type HelperProps<T> = {
  id: string;
  Child: FunctionComponent<LoaderData<T>>;
  loader: { read: () => T };
  loading: Signal<boolean>;
};
const Helper = memo(function <T>({
  id,
  Child,
  loader,
  loading,
}: HelperProps<T>) {
  const loaderData = loader.read();
  const stringified =
    !isBrowser() || loading.value ? JSON.stringify(loaderData) : "{}";

  const data = { loaderData };

  return (
    <section id={id} data-page={true} data-loader={stringified}>
      <Child {...data} id={id} />
    </section>
  );
});
