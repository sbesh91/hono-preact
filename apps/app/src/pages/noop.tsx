import { Route } from 'preact-iso';

function noop() {
  return null;
}

export default function Noop() {
  return <Route default component={noop} />;
}
