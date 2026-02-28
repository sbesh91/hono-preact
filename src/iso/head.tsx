import { createContext, Fragment, FunctionComponent } from 'preact';
import { LocationHook, useLocation } from 'preact-iso';
import { Suspense, useContext, useRef, memo } from 'preact/compat';
import { isBrowser } from './is-browser.js';
import wrapPromise from './wrap-promise';

export const Head: FunctionComponent = memo(() => {
  const ctx = useHeadContext();
  const wrappedRef = useRef(wrapPromise(ctx.promise));

  return (
    <Suspense fallback={<meta about="loading..." />}>
      <Helper promise={wrappedRef.current} />
    </Suspense>
  );
});

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
  const resolversRef = useRef(Promise.withResolvers<FunctionComponent>());
  const { promise, resolve, reject } = resolversRef.current;

  if (!isBrowser()) {
    // hack to resolve promise if unresolved
    // queueMicrotask(() => resolve(() => <Fragment />));
    setTimeout(() => resolve(() => <Fragment />), 16);
  }

  return (
    <HeadContext.Provider value={{ promise, resolve, reject, location }}>
      {props.children}
    </HeadContext.Provider>
  );
};

export function useHeadContext() {
  const ctx = useContext(HeadContext);

  if (!ctx) {
    throw 'must be used within a head context';
  }

  return ctx;
}
