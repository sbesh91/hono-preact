import { createContext, Fragment, FunctionComponent } from 'preact';
import { Signal, useSignal } from '@preact/signals';
import { LocationHook, useLocation } from 'preact-iso';
import { useContext } from 'preact/compat';

export const Head: FunctionComponent = () => {
  const { headSignal } = useHeadContext();
  const Component = headSignal.value;
  return <Component />;
};

interface HeadContextProps {
  headSignal: Signal<FunctionComponent>;
  location: LocationHook;
}

export const HeadContext = createContext<HeadContextProps | null>(null);

export const HeadContextProvider: FunctionComponent = (props) => {
  const location = useLocation();
  const headSignal = useSignal<FunctionComponent>(() => <Fragment />);

  return (
    <HeadContext.Provider value={{ headSignal, location }}>
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
