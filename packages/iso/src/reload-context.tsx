import { createContext } from 'preact';
import { useContext } from 'preact/hooks';

export type ReloadContextValue = {
  reload: () => void;
  reloading: boolean;
  error: Error | null;
  /**
   * Identity of the loader that owns this <Loader>'s ReloadContext. Used by
   * `useAction({ invalidate: [refs] })` to detect when one of the invalidated
   * refs matches the currently-active page so the page also re-fetches.
   * Optional: callers that don't host a loader (e.g. raw test renders) may
   * omit it.
   */
  loaderId?: symbol;
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
