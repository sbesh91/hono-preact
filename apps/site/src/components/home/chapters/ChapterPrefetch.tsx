import type { VNode } from 'preact';
import { ScrollStage, useStageProgress } from '../scroll/stage.js';
import { BrowserFrame } from '../scroll/primitives.js';
import { Code } from '../scroll/code.js';
import { clamp01 } from '../scroll/progress.js';

const SNIPPET = `// one line in your app config
export default defineApp({ speculation: true });
// or bind a specific link's loader to any intent (hover, focus, touch):
const prefetchIssue = usePrefetch(href, serverLoaders.issue);`;

// The Invoices route's resources, each warming at a slightly different point so
// the "in parallel" fetch reads as several requests landing near-together.
const WARM_ROWS = [
  { name: 'invoices.route.js', at: 0.42 },
  { name: 'invoices.data.json', at: 0.5 },
  { name: 'table.css', at: 0.46 },
  { name: 'chart.js', at: 0.56 },
];

// One playhead drives the whole beat: a pointer glides to the "Invoices" link,
// hovering warms that route's resources in parallel, then a click opens the
// page instantly from cache. Every value derives from progress; there is no
// real pointer input.
function PrefetchDemo(): VNode {
  const { progress } = useStageProgress();
  const hovering = progress > 0.32;
  const opened = progress > 0.78;

  // Glide up onto the "Invoices" link and settle there *before* warming starts,
  // so the pointer is visibly hovering the link through the whole preload; a
  // click pulse fires later as the page opens.
  const travel = clamp01((progress - 0.04) / 0.24); // on the link by ~0.28
  const cursorLeft = 33 + travel * 54; // 33% -> 87% (over "Invoices")
  const cursorTop = 80 - travel * 70; // 80% -> 10% (the nav row)
  const clicking = progress > 0.7 && progress < 0.82;

  return (
    <div class="hx-prefetch">
      <div class="hx-prefetch__nav">
        <span class="hx-prefetch__brand">Acme</span>
        <span class="hx-prefetch__link" data-warm={hovering ? '' : undefined}>
          Invoices
        </span>
      </div>

      <span
        class="hx-prefetch__cursor"
        aria-hidden="true"
        style={{ left: `${cursorLeft}%`, top: `${cursorTop}%` }}
      >
        {clicking && <span class="hx-prefetch__click" />}
        <svg viewBox="0 0 16 16" width="19" height="19" aria-hidden="true">
          <path
            d="M2 1.5 L2 13 L5 10.2 L7.1 14.6 L9.1 13.7 L7 9.4 L11 9.4 Z"
            fill="var(--foreground)"
            stroke="var(--surface)"
            stroke-width="1.1"
            stroke-linejoin="round"
          />
        </svg>
      </span>

      <div class="hx-prefetch__panel" role="status">
        <p class="hx-prefetch__panel-head">
          {hovering
            ? 'Warming the Invoices route in parallel'
            : 'Hover a link to warm its route'}
        </p>
        <ul class="hx-prefetch__rows">
          {WARM_ROWS.map((row) => {
            const ready = progress > row.at;
            return (
              <li key={row.name} class="hx-prefetch__row">
                <code>{row.name}</code>
                <span
                  class="hx-prefetch__ready"
                  data-ready={ready ? '' : undefined}
                >
                  {ready ? 'ready' : '…'}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div class="hx-prefetch__dest" data-arrived={opened ? '' : undefined}>
        <p class="hx-prefetch__dest-title">Invoices</p>
        <p class="hx-prefetch__dest-line">
          {opened
            ? 'Opened from warm cache. No spinner.'
            : 'Click lands instantly once warm.'}
        </p>
      </div>
    </div>
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
              <p class="hx-scene__step">
                <span class="hx-scene__num">06</span>Navigation
              </p>
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
              <PrefetchDemo />
            </BrowserFrame>
          </div>
        </div>
      </ScrollStage>
    </section>
  );
}
