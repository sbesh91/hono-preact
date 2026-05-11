import type { VNode } from 'preact';

export function ClientScript(): VNode {
  const src = import.meta.env.PROD
    ? '/static/client.js'
    : '/@id/__x00__virtual:hono-preact/client';
  return <script type="module" src={src} />;
}
