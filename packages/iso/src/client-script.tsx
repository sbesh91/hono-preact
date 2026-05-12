import type { VNode } from 'preact';

export function ClientScript(): VNode {
  const src = import.meta.env.PROD
    ? '/static/client.js'
    : '/@id/__x00__virtual:hono-preact/client';
  // `async` on a module script: download in parallel with parsing AND execute
  // as soon as available, rather than waiting for the document to finish
  // parsing. Critical for streaming SSR: without it, the client entry waits
  // for the entire streaming response to close before hydrating, by which
  // time every chunk has queued, and the post-hydration drain collapses
  // them all into a single render at the final value.
  return <script type="module" src={src} async />;
}
