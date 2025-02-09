import type { FunctionComponent } from "preact";
import { Suspense, lazy } from "preact/compat";

export const Test: FunctionComponent = () => {
  const props = lazy(
    () =>
      new Promise<{ default: string }>((resolve) =>
        setTimeout(() => {
          resolve({ default: "hello world" });
        }, 200)
      )
  );

  return (
    <section class="p-1">
      <a href="/" class="bg-amber-200">
        home
      </a>
      <Suspense fallback="loading...">{props}</Suspense>
    </section>
  );
};

export default Test;
