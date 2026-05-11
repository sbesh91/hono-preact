import { createContext } from 'preact';
import { useContext } from 'preact/hooks';

export type ReloadContextValue = {
  reload: () => void;
  reloading: boolean;
};

export const ReloadContext = createContext<ReloadContextValue | undefined>(
  undefined
);

export function useReload(): ReloadContextValue {
  const ctx = useContext(ReloadContext);
  if (!ctx)
    throw new Error('useReload must be called inside a route or <Page> with a loader');
  return ctx;
}
