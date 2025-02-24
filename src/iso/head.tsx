import { createContext, FunctionComponent } from "preact";
import { LocationHook, useLocation } from "preact-iso";
import { Suspense, useContext } from "preact/compat";
import wrapPromise from "./wrap-promise";

export const Head: FunctionComponent = () => {
  const ctx = useHeadContext();
  const promise = () => wrapPromise(ctx.promise);

  // the source of the strange loading seems to be this suspense
  // and when it interacts with the suspense loading routes

  return (
    <Suspense fallback={<meta about="loading..." />}>
      <Helper promise={promise()} />
    </Suspense>
  );
};

const Helper = ({
  promise,
}: {
  promise: { read: () => FunctionComponent };
}) => {
  const Component = promise.read();

  return <Component />;
};

interface HeadContextProps {
  promise: Promise<FunctionComponent>;
  resolve: (fc: FunctionComponent) => void;
  reject: (reason?: any) => void;
  location: LocationHook;
}

export const HeadContext = createContext<HeadContextProps | null>(null);

export const HeadContextProvider: FunctionComponent = (props) => {
  const location = useLocation();
  const { promise, resolve, reject } =
    Promise.withResolvers<FunctionComponent>();

  return (
    <HeadContext.Provider value={{ promise, resolve, reject, location }}>
      {props.children}
    </HeadContext.Provider>
  );
};

export function useHeadContext() {
  const ctx = useContext(HeadContext);

  if (!ctx) {
    throw "must be used within a head context";
  }

  return ctx;
}
