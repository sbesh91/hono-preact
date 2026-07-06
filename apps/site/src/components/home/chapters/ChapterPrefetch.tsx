import type { VNode } from 'preact';
import { ScrollStage, useStageProgress } from '../scroll/stage.js';
import { BrowserFrame, Region } from '../scroll/primitives.js';
import { Code } from '../scroll/code.js';
import { clamp01 } from '../scroll/progress.js';

const SNIPPET = `// one line in your app config
export default defineApp({ speculation: true });
// or bind a specific link's loader to any intent (hover, focus, touch):
const prefetchIssue = usePrefetch(href, serverLoaders.issue);`;

const WARM_ROWS = ['sales.js', 'invoices.js', 'invoice.json', 'invoice.css'];

// Reads the stage playhead and glides a decorative pointer toward the link.
// Everything derives from progress; there is no real pointer input.
function DemoCursor(): VNode {
  const { progress } = useStageProgress();
  const t = clamp01((progress - 0.1) / 0.55); // travels between .1 and .65
  const left = 14 + t * 44; // 14% -> 58%
  const top = 76 - t * 40; //  76% -> 36%
  return (
    <span
      class="hx-prefetch__cursor"
      aria-hidden="true"
      style={{ left: `${left}%`, top: `${top}%` }}
    >
      <svg viewBox="0 0 12 12" width="18" height="18" aria-hidden="true">
        <path
          d="M1 1 L1 10 L4 7 L6 11 L8 10 L6 6 L10 6 Z"
          fill="currentColor"
        />
      </svg>
    </span>
  );
}

export function ChapterPrefetch(): VNode {
  return (
    <section class="hx-chapter">
      <ScrollStage
        pages={2.6}
        pagesNarrow={2}
        unpinOnNarrow
        fallbackProgress={0.95}
        label="Instant navigation demo"
      >
        <div class="hx-scene">
          <div class="hx-cols2">
            <div class="hx-prefetch__intro">
              <p class="hx-scene__step">Navigation</p>
              <h2 class="hx-scene__title">Instant navigation.</h2>
              <p class="hx-scene__desc">
                Hover warms the cache before the click. hono-preact hands
                whole-page link prefetch to the browser-native Speculation Rules
                API, plus typed usePrefetch on any intent. The live docs site
                runs it.
              </p>
              <pre class="hx-prefetch__code">
                <Code source={SNIPPET} />
              </pre>
              <a class="hx-prefetch__demo" href="/docs">
                See it on the live docs
              </a>
            </div>
            <BrowserFrame url="example.app / dashboard">
              <div class="hx-prefetch">
                <div class="hx-prefetch__nav">
                  <span class="hx-prefetch__brand">Acme</span>
                  <span class="hx-prefetch__link">Invoices</span>
                </div>
                <DemoCursor />
                <Region
                  showAt={0.68}
                  skeleton={
                    <p class="hx-prefetch__hint">hover to warm the cache</p>
                  }
                >
                  <div class="hx-prefetch__pop" role="status">
                    <p class="hx-prefetch__pop-head">Prefetching in parallel</p>
                    <ul class="hx-prefetch__rows">
                      {WARM_ROWS.map((name) => (
                        <li key={name} class="hx-prefetch__row">
                          <code>{name}</code>
                          <span class="hx-prefetch__ready">ready</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </Region>
                <Region
                  showAt={0.9}
                  skeleton={
                    <div
                      class="hx-prefetch__dest hx-prefetch__dest--wait"
                      aria-hidden="true"
                    />
                  }
                >
                  <div class="hx-prefetch__dest">
                    <p class="hx-prefetch__dest-title">Invoice INV-204</p>
                    <p class="hx-prefetch__dest-line">
                      Rendered from warm cache. No spinner.
                    </p>
                  </div>
                </Region>
              </div>
            </BrowserFrame>
          </div>
        </div>
      </ScrollStage>
    </section>
  );
}
