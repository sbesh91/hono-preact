import { FunctionComponent } from 'preact';
import { exec, useLocation } from 'preact-iso';
import { LoaderData } from './loader';

export function useLocationData<T>({
  Child,
}: {
  Child: FunctionComponent<LoaderData<T>>;
}) {
  const location = useLocation();

  const routeMatch =
    exec(location.url, Child.defaultProps?.route ?? '') !== undefined;

  return {
    location,
    routeMatch,
  };
}
