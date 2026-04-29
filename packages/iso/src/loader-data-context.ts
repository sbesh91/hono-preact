import { createContext } from 'preact';
import { useContext } from 'preact/hooks';

const SENTINEL = Symbol('loader-data-uninitialized');

export const LoaderDataContext = createContext<unknown>(SENTINEL);

export function useLoaderData<T>(): T {
  const data = useContext(LoaderDataContext);
  if (data === SENTINEL) {
    throw new Error(
      'useLoaderData must be called inside a component rendered by getLoaderData'
    );
  }
  return data as T;
}
