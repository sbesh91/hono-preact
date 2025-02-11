import { FunctionComponent } from "preact";
import { isBrowser } from "./is-browser";
import { LoaderData } from "./loader";

export function Page<T>({
  loaderData,
  id,
  Child,
}: LoaderData<T> & { id: string; Child: FunctionComponent<LoaderData<T>> }) {
  const stringified = !isBrowser() ? JSON.stringify(loaderData) : "{}";
  const data = { loaderData };

  return (
    <section id={id} data-page={true} data-loader={stringified}>
      <Child {...data} id={id} />
    </section>
  );
}
