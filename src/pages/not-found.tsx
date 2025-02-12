import { Route, useLocation } from "preact-iso";

export function PageNotFound() {
  const location = useLocation();
  return <div>Page Not Found {location.url}</div>;
}

export function NotFound() {
  return <Route default component={PageNotFound} />;
}
