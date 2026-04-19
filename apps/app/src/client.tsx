// shims must be imported first
import './shims/process.js';

import { hydrate } from 'preact';
import { LocationProvider } from 'preact-iso';

import { Base } from './iso.js';

const app = document.getElementById('app') as HTMLElement;

export const App = () => {
  return (
    <LocationProvider>
      <Base />
    </LocationProvider>
  );
};

hydrate(<App />, app);
