import { motion } from 'motion/react';
import { FunctionComponent } from 'preact';
import { LocationHook } from 'preact-iso';
import { memo, Suspense, useEffect, useId } from 'preact/compat';
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
};

export const Page = memo(function <T extends {}>({
  Child,
  serverLoader = async () => ({}) as T,
  clientLoader = serverLoader,
  Head,
  location,
}: PageProps<T>) {
  const id = useId();

  const preloaded = getPreloadedData<T>(id);
  const isLoaded = Object.keys(preloaded).length > 0;

  if (isLoaded) {
    return (
      <Helper
        id={id}
        Child={Child}
        loader={{ read: () => preloaded }}
        Head={Head}
      />
    );
  }

  const loader = () =>
    wrapPromise(
      isBrowser() ? clientLoader({ location }) : serverLoader({ location })
    );

  return (
    <Suspense fallback={null}>
      <Helper id={id} Child={Child} loader={loader()} Head={Head} />
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
  Head,
}: HelperProps<T>) {
  const ctx = useHeadContext();
  const loaderData = loader.read();
  const stringified = !isBrowser() ? JSON.stringify(loaderData) : '{}';

  useEffect(() => {
    Head && ctx.resolve(Head);
  }, [Head]);

  const data = { loaderData };

  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      key={id}
      id={id}
      data-page={true}
      data-loader={stringified}
    >
      <Child {...data} id={id} />
    </motion.section>
  );
});
