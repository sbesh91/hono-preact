import { FunctionComponent } from 'preact';
import { LocationHook } from 'preact-iso';
import { memo, Suspense, useId, useRef } from 'preact/compat';
import { type LoaderCache } from './cache';
import { isBrowser } from './is-browser';
import { Loader, LoaderData } from './loader';
import { getPreloadedData } from './preload';
import wrapPromise from './wrap-promise';

type PageProps<T> = {
  Child: FunctionComponent<LoaderData<T>>;
  serverLoader?: Loader<T>;
  clientLoader?: Loader<T>;
  location: LocationHook;
  cache?: LoaderCache<T>;
};

export const Page = memo(function <T extends {}>({
  Child,
  serverLoader = async () => ({}) as T,
  clientLoader = serverLoader,
  location,
  cache,
}: PageProps<T>) {
  const id = useId();

  const preloaded = getPreloadedData<T>(id);
  const isLoaded = Object.keys(preloaded).length > 0;

  if (isLoaded) {
    cache?.set(location.path, preloaded);
    return <Helper id={id} Child={Child} loader={{ read: () => preloaded }} />;
  }

  if (isBrowser() && cache?.has(location.path)) {
    const cached = cache.get(location.path)!;
    return <Helper id={id} Child={Child} loader={{ read: () => cached }} />;
  }

  const loaderRef = useRef(
    wrapPromise(
      isBrowser()
        ? clientLoader({ location }).then((r) => {
            cache?.set(location.path, r);
            return r;
          })
        : serverLoader({ location })
    )
  );

  return (
    <Suspense fallback={null}>
      <Helper id={id} Child={Child} loader={loaderRef.current} />
    </Suspense>
  );
});

type HelperProps<T> = {
  id: string;
  Child: FunctionComponent<LoaderData<T>>;
  loader: { read: () => T };
};
export const Helper = memo(function <T>({ id, Child, loader }: HelperProps<T>) {
  const loaderData = loader.read();
  const stringified = !isBrowser() ? JSON.stringify(loaderData) : '{}';

  return (
    <section id={id} data-page={true} data-loader={stringified}>
      <Child loaderData={loaderData} id={id} />
    </section>
  );
});
