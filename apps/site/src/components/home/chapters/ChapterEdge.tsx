import type { VNode } from 'preact';
import { Reveal } from '../scroll/primitives.js';
import { Code } from '../scroll/code.js';

const EYEBROW = 'The platform';
const TITLE = 'Runs on the platform, at the edge.';
const DESC =
  'One app on Hono, built from web standards. Write it once; it renders on the server and serves realtime the same way, whether you ship to Cloudflare Workers or Node.';
const SNIPPET = `adapter: cloudflareAdapter()
// or nodeAdapter()`;

export function ChapterEdge(): VNode {
  return (
    <section class="hx-chapter">
      <div class="hx-scene">
        <div class="hx-scene__head">
          <p class="hx-scene__step hx-scene__step--muted">{EYEBROW}</p>
          <h2 class="hx-scene__title">{TITLE}</h2>
          <p class="hx-scene__desc">{DESC}</p>
        </div>

        <div class="hx-edge-cards">
          <Reveal>
            <article class="hx-edge-card">
              <h3 class="hx-edge-card__title">Edge</h3>
              <p class="hx-edge-card__line">
                One source deploys to either runtime, no rewrite between them.
              </p>
              <div class="hx-edge-card__meta">
                <span class="hx-edge-tag">Cloudflare Workers</span>
                <span class="hx-edge-tag">Node</span>
              </div>
            </article>
          </Reveal>

          <Reveal delayMs={80}>
            <article class="hx-edge-card">
              <h3 class="hx-edge-card__title">Web standards</h3>
              <p class="hx-edge-card__line">
                hono-preact is a Web Fetch app on Hono.
              </p>
              <div class="hx-edge-card__meta">
                <span class="hx-edge-tag">Request</span>
                <span class="hx-edge-tag">Response</span>
              </div>
            </article>
          </Reveal>

          <Reveal delayMs={160}>
            <article class="hx-edge-card">
              <h3 class="hx-edge-card__title">One-line adapter swap</h3>
              <p class="hx-edge-card__line">
                You pick the runtime with a one-line adapter.
              </p>
              <pre class="hx-edge-card__code">
                <Code source={SNIPPET} />
              </pre>
            </article>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
