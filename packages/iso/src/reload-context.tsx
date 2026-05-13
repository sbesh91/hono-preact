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
    throw new Error('useReload() must be called inside a `loader.View` render function or inside a `loader.Boundary`.');
  return ctx;
}
