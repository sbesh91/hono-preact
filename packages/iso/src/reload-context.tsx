import { createContext } from 'preact';
import { useContext } from 'preact/hooks';

type ReloadContextValue = {
  reload: () => void;
  reloading: boolean;
  error: Error | null;
};

export const ReloadContext = createContext<ReloadContextValue | undefined>(
  undefined
);

export function useReload(): ReloadContextValue {
  const ctx = useContext(ReloadContext);
  if (!ctx)
    throw new Error('useReload must be called inside a <Page> with a loader');
  return ctx;
}
