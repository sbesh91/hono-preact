import type { VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Code } from '../scroll/code.js';
import { useInView, usePrefersReducedMotion } from '../scroll/motion.js';

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
  const reduced = usePrefersReducedMotion();
  // The pills stagger in when the row scrolls into view. One in-view trigger on
  // the <ul> drives the whole cascade; each pill's own delay comes from its --i
  // index in CSS, so the markup stays a plain semantic list.
  const [rowRef, shown] = useInView<HTMLUListElement>({ disabled: reduced });
  // The hidden-then-stagger treatment only arms after mount (client JS is
  // running): SSR, a failed bundle, and no-JS render the pills visible rather
  // than stranded hidden waiting for an in-view trigger that never fires.
  const [armed, setArmed] = useState(false);
  useEffect(() => setArmed(true), []);
  return (
    <section class="hx-chapter">
      <div class="hx-scene">
        <div class="hx-scene__head">
          <p class="hx-scene__step hx-scene__step--muted">The whole surface</p>
          <h2 class="hx-scene__title">One package, typed throughout.</h2>
          <p class="hx-scene__desc">
            A single hono-preact install gives you the runtime, /server, /vite,
            and both /adapter-* targets. One dependency, typed end to end, with
            nothing to wire up between the pieces.
          </p>
        </div>
        <ul
          class="hx-pkg-row"
          ref={rowRef}
          data-armed={String(armed)}
          data-shown={String(shown)}
        >
          {SUBPATHS.map((path, i) => (
            <li key={path} class="hx-pkg-pill" style={{ '--i': i }}>
              {path}
            </li>
          ))}
        </ul>
        <pre class="hx-pkg-code">
          <Code source={SNIPPET} />
        </pre>
      </div>
    </section>
  );
}
