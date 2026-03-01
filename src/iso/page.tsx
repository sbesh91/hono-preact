import { Fragment, FunctionComponent } from 'preact';
import { LocationHook } from 'preact-iso';
import { memo, Suspense, useEffect, useId, useRef } from 'preact/compat';
import { type LoaderCache } from './cache';
import { useHeadContext } from './head';
import { isBrowser } from './is-browser';
import { Loader, LoaderData } from './loader';
import { getPreloadedData } from './preload';
import wrapPromise from './wrap-promise';

type PageProps<T> = {
  Child: FunctionComponent<LoaderData<T>>;
  serverLoader?: Loader<T>;
  clientLoader?: Loader<T>;
  Head?: FunctionComponent;
  location: LocationHook;
  cache?: LoaderCache<T>;
};

export const Page = memo(function <T extends {}>({
  Child,
  serverLoader = async () => ({}) as T,
  clientLoader = serverLoader,
  Head,
  location,
  cache,
}: PageProps<T>) {
  const id = useId();

  const preloaded = getPreloadedData<T>(id);
  const isLoaded = Object.keys(preloaded).length > 0;

  if (isLoaded) {
    cache?.set(location.path, preloaded);
    return (
      <Helper
        id={id}
        Child={Child}
        loader={{ read: () => preloaded }}
        Head={Head}
      />
    );
  }

  if (isBrowser() && cache?.has(location.path)) {
    const cached = cache.get(location.path)!;
    console.log('return cached', cached);
    return (
      <Helper
        id={id}
        Child={Child}
        loader={{ read: () => cached }}
        Head={Head}
      />
    );
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
      <Helper id={id} Child={Child} loader={loaderRef.current} Head={Head} />
    </Suspense>
  );
});

type HelperProps<T> = {
  id: string;
  Child: FunctionComponent<LoaderData<T>>;
  loader: { read: () => T };
  Head?: FunctionComponent;
};
export const Helper = memo(function <T>({
  id,
  Child,
  loader,
  Head = () => <Fragment />,
}: HelperProps<T>) {
  const ctx = useHeadContext();
  const loaderData = loader.read();
  const stringified = !isBrowser() ? JSON.stringify(loaderData) : '{}';

  useEffect(() => {
    ctx.headSignal.value = Head;
  }, [Head]);

  const data = { loaderData };

  return (
    <section id={id} data-page={true} data-loader={stringified}>
      <Child {...data} id={id} />
    </section>
  );
});
