import { FunctionComponent } from "preact";
import { useLocation, useRoute } from "preact-iso";
import { exec } from "preact-iso/router";
import { LoaderData } from "./loader";

export function useLocationData<T>({
  Child,
}: {
  Child: FunctionComponent<LoaderData<T>>;
}) {
  const location = useLocation();
  const route = useRoute();

  const routeMatch =
    exec(location.url, Child.defaultProps?.route ?? "") !== undefined;

  return {
    location,
    route,
    routeMatch,
  };
}
