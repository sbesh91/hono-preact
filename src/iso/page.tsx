import { Signal } from "@preact/signals";
import { FunctionComponent } from "preact";
import { memo, Suspense, useId } from "preact/compat";
import { isBrowser } from "./is-browser";
import { Loader, LoaderData } from "./loader";
import { getPreloadedData } from "./preload";
import { useClientFetch } from "./use-client-fetch";
import { useLocationData } from "./use-locaton";
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
  const { route, routeMatch } = useLocationData({ Child });
  const { loaderData, loading } = useClientFetch({ Child, clientLoader, id });

  const preloaded = getPreloadedData<T>(id);
  const isLoaded = Object.keys(preloaded).length > 0;

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
export const Helper = memo(function <T>({
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
