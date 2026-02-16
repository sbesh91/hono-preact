// shims must be imported first
// import './shims/process.js';

import { hydrate } from 'preact';
import { LocationProvider } from 'preact-iso';
import { createPortal } from 'preact/compat';
import 'preact/debug';
import { Base } from './iso.js';
import { Head, HeadContextProvider } from './iso/head.js';

const app = document.getElementById('app') as HTMLElement;
const head = document.getElementById('head') as HTMLElement;

export const App = () => {
  return (
    <LocationProvider>
      <HeadContextProvider>
        {createPortal(<Head />, head)}
        <Base />
      </HeadContextProvider>
    </LocationProvider>
  );
};

hydrate(<App />, app);
