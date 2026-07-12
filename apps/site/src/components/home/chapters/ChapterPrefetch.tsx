import type { VNode } from 'preact';
import { ScrollStage, useStageValue } from '../scroll/stage.js';
import { BrowserFrame } from '../scroll/primitives.js';
import { Code } from '../scroll/code.js';

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

// One row of the warm-up panel. Its own component so its threshold is its own
// subscription: the row flips once when the playhead passes it, instead of the
// whole panel re-rendering because some other row moved.
function WarmRow({ name, at }: { name: string; at: number }): VNode {
  const ready = useStageValue((progress) => progress > at);
  return (
    <li class="hx-prefetch__row">
      <code>{name}</code>
      <span class="hx-prefetch__ready" data-ready={ready ? '' : undefined}>
        {ready ? 'ready' : '…'}
      </span>
    </li>
  );
}

// One playhead drives the whole beat: a pointer glides to the "Invoices" link,
// hovering warms that route's resources in parallel, then a click opens the page
// instantly from cache. There is no real pointer input.
//
// The glide itself is CSS (see .hx-prefetch__cursor, which walks a percentage of
// its own full-size box off --hx-p), so the cursor tracks the scroll with no
// render and no measured geometry. What is left here is the discrete beats: the
// link warming, the click pulse, and the page opening.
function PrefetchDemo(): VNode {
  const hovering = useStageValue((progress) => progress > 0.32);
  const opened = useStageValue((progress) => progress > 0.78);
  const clicking = useStageValue(
    (progress) => progress > 0.7 && progress < 0.82
  );

  return (
    <div class="hx-prefetch">
      <div class="hx-prefetch__nav">
        <span class="hx-prefetch__brand">Acme</span>
        <span class="hx-prefetch__link" data-warm={hovering ? '' : undefined}>
          Invoices
        </span>
      </div>

      <span class="hx-prefetch__cursor" aria-hidden="true">
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
          {WARM_ROWS.map((row) => (
            <WarmRow key={row.name} name={row.name} at={row.at} />
          ))}
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
