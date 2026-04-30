import { hydrate } from 'preact';
import { LocationProvider } from 'preact-iso';

import { Base } from './iso.js';

const app = document.getElementById('app') as HTMLElement;

export const App = () => (
  <LocationProvider>
    <Base />
  </LocationProvider>
);

hydrate(<App />, app);
