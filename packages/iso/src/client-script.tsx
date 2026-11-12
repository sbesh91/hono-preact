import type { VNode } from 'preact';
import { useContext } from 'preact/hooks';
import {
  CLIENT_ENTRY_URL,
  VIRTUAL_CLIENT_DEV_URL,
} from './internal/contract.js';
import { DevModeContext } from './internal/contexts.js';

export function ClientScript(): VNode {
  // The server render supplies the dev flag. Reading `import.meta.env` here
  // would throw under a Node server, which loads this package externalized
  // (Vite never injects `import.meta.env` there); the guarded read only serves
  // renders outside `renderPage`.
  const dev =
    useContext(DevModeContext) ??
    (typeof import.meta.env === 'undefined' || !import.meta.env.PROD);
  const src = dev ? VIRTUAL_CLIENT_DEV_URL : CLIENT_ENTRY_URL;
  // `async` on a module script: download in parallel with parsing AND execute
  // as soon as available, rather than waiting for the document to finish
  // parsing. Critical for streaming SSR: without it, the client entry waits
  // for the entire streaming response to close before hydrating, by which
  // time every chunk has queued, and the post-hydration drain collapses
  // them all into a single render at the final value.
  return <script type="module" src={src} async />;
}
