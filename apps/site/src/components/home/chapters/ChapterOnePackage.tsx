import type { VNode } from 'preact';
import { Reveal } from '../scroll/primitives.js';

const SUBPATHS = [
  'hono-preact',
  'hono-preact/server',
  'hono-preact/vite',
  'hono-preact/adapter-*',
] as const;

const SNIPPET = `import { defineRoutes } from 'hono-preact';
import { honoPreact } from 'hono-preact/vite';
import { cloudflareAdapter } from 'hono-preact/adapter-cloudflare';`;

export function ChapterOnePackage(): VNode {
  return (
    <section class="hx-chapter">
      <div class="hx-scene">
        <div class="hx-scene__head">
          <span class="hx-scene__step">The whole surface</span>
          <h2 class="hx-scene__title">One package, typed throughout.</h2>
          <p class="hx-scene__desc">
            A single hono-preact install gives you the runtime, /server, /vite,
            and both /adapter-* targets. Typed end to end, and every PR measures
            each feature client-JS cost.
          </p>
        </div>
        <Reveal>
          <ul class="hx-pkg-row">
            {SUBPATHS.map((path) => (
              <li key={path} class="hx-pkg-pill">
                {path}
              </li>
            ))}
          </ul>
        </Reveal>
        <pre class="hx-pkg-code">
          <code>{SNIPPET}</code>
        </pre>
      </div>
    </section>
  );
}
