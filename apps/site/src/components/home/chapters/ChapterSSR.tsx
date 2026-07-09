import type { VNode } from 'preact';
import { ScrollStage } from '../scroll/stage.js';
import { BrowserFrame, Wire, Lane, Region } from '../scroll/primitives.js';
import { Code } from '../scroll/code.js';

// Exact framework API snippet. Rendered verbatim inside <pre>; the JSX-looking
// text is a string (no `${` sequences), so a template literal is safe.
const snippet = `export const serverLoaders = {
  default: defineLoader(async ({ signal }) => getProjects({ signal })),
};
const View = serverLoaders.default.View(({ data }) =>
  data ? <List items={data} /> : <Spinner />
);`;

export function ChapterSSR(): VNode {
  return (
    <section class="hx-chapter">
      <ScrollStage
        pages={3.4}
        pagesNarrow={2.4}
        fallbackProgress={0.45}
        label="SSR, no client waterfall"
      >
        <div class="hx-scene">
          <div class="hx-scene__head">
            <p class="hx-scene__step">
              <span class="hx-scene__num">02</span>SSR
            </p>
            <h2 class="hx-scene__title">SSR, no client waterfall.</h2>
            <p class="hx-scene__desc">
              Loaders run in parallel on the server and one HTML document
              streams down. The client never staircases through per-component
              fetches.
            </p>
          </div>

          <div class="hx-cols2 hx-cols2--compare">
            {/* LEFT: fetch in components (the staircase). Chained bars; the UI
                regions only fill late, after the last request lands. */}
            <div class="hx-panel">
              <p class="hx-panel__cap">fetch in components</p>
              <BrowserFrame url="example.app / projects">
                <Region showAt={0.55} skeleton={<span class="hx-sk-line" />}>
                  <strong>Projects</strong>
                </Region>
                <Region showAt={0.72} skeleton={<span class="hx-sk-line" />}>
                  Q3 Sales
                </Region>
                <Region showAt={0.9} skeleton={<span class="hx-sk-line" />}>
                  Invoice #102000
                </Region>
              </BrowserFrame>
              <Wire caption="network: fetch in components">
                <Lane label="document" start={0} size={0.12} />
                <Lane label="root.js" start={0.12} size={0.12} />
                <Lane label="data.json" start={0.24} size={0.16} />
                <Lane label="sales.js" start={0.4} size={0.16} />
                <Lane label="invoice.json" start={0.56} size={0.22} />
              </Wire>
            </div>

            {/* RIGHT: hono-preact SSR (the parallel block). Document and loaders
                start together (gradient tone); the UI snaps in far earlier. */}
            <div class="hx-panel">
              <p class="hx-panel__cap">hono-preact SSR</p>
              <BrowserFrame url="example.app / projects">
                <Region showAt={0.32} skeleton={<span class="hx-sk-line" />}>
                  <strong>Projects</strong>
                </Region>
                <Region showAt={0.34} skeleton={<span class="hx-sk-line" />}>
                  Q3 Sales
                </Region>
                <Region showAt={0.36} skeleton={<span class="hx-sk-line" />}>
                  Invoice #102000
                </Region>
              </BrowserFrame>
              <Wire caption="network: hono-preact SSR">
                <Lane label="document" start={0} size={0.3} tone="grad" />
                <Lane label="loaders" start={0} size={0.26} tone="grad" />
                <Lane label="hydrate.js" start={0.04} size={0.24} tone="grad" />
              </Wire>
            </div>
          </div>

          <pre class="hx-code">
            <Code source={snippet} />
          </pre>
        </div>
      </ScrollStage>
      {/* Phone-only copy of the code (see .hx-chapter__coda). */}
      <div class="hx-chapter__coda">
        <pre class="hx-code">
          <Code source={snippet} />
        </pre>
      </div>
    </section>
  );
}
