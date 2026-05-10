import type { FunctionComponent } from 'preact';
import { flushSync } from 'preact/compat';
import { Routes } from '@hono-preact/iso';
import routes from './routes.js';

function onRouteChange() {
  document.startViewTransition(() => flushSync(() => {}));
}

export const Base: FunctionComponent = () => {
  return <Routes routes={routes} onRouteChange={onRouteChange} />;
};
