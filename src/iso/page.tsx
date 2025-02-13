import { FunctionComponent } from "preact";
import { useRoute } from "preact-iso";
import { memo, Suspense, useId } from "preact/compat";
import { isBrowser } from "./is-browser";
import { Loader, LoaderData } from "./loader";
import { getPreloadedData } from "./preload";
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
  const route = useRoute();
  const preloaded = getPreloadedData<T>(id);
  const isLoaded = Object.keys(preloaded).length > 0;

  // double renders the first route?
  // triple renders the second?
  // stabilizes after?
  if (isLoaded) {
    return <Helper id={id} Child={Child} loader={{ read: () => preloaded }} />;
  }

  const loader = wrapPromise(
    !isBrowser()
      ? serverLoader({ route })
      : clientLoader({ route }).catch(console.log)
  ) as { read: () => T };

  return (
    <Suspense fallback={null}>
      <Helper id={id} Child={Child} loader={loader} />
    </Suspense>
  );
});

type HelperProps<T> = {
  id: string;
  Child: FunctionComponent<LoaderData<T>>;
  loader: { read: () => T };
};
const Helper = memo(function <T>({ id, Child, loader }: HelperProps<T>) {
  const loaderData = loader.read();
  const stringified = !isBrowser() ? JSON.stringify(loaderData) : "{}";
  const data = { loaderData };

  return (
    <section id={id} data-page={true} data-loader={stringified}>
      <Child {...data} id={id} />
    </section>
  );
});
