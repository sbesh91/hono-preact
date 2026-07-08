import type { VNode } from 'preact';
import { ScrollStage, useStageProgress } from '../scroll/stage.js';
import { BrowserFrame, Region, Wire, Lane } from '../scroll/primitives.js';
import { Code } from '../scroll/code.js';

// Real framework snippet (a streaming async-generator loader + its live View).
const FEED_SNIPPET = `export const serverLoaders = {
  feed: defineLoader(async function* ({ signal }) {
    while (!signal.aborted) yield await snapshot();
  }),
};
const Live = serverLoaders.feed.View(
  (s) => (s.status === 'open' ? <Count n={s.data} /> : <Connecting />),
  { initial: null, reduce: (_, snap) => snap }
);`;

// Reads the stage playhead and animates a big streaming count. Must live inside
// <ScrollStage> so useStageProgress resolves to the stage playhead.
function LiveCount(): VNode {
  const { progress } = useStageProgress();
  const n = Math.floor(progress * 1284);
  return (
    <div class="hx-stream__count" aria-hidden="true">
      {n.toLocaleString()}
    </div>
  );
}

// Fixed throughput samples; the area chart draws in left-to-right as the stage
// playhead advances, so it reads as live data arriving rather than a static box.
const SAMPLES = [6, 10, 8, 15, 12, 20, 16, 25, 21, 30, 27, 34, 31, 39];

function StreamChart(): VNode {
  const { progress } = useStageProgress();
  const n = SAMPLES.length;
  const W = 120;
  const H = 40;
  const PAD = 2;
  const max = Math.max(...SAMPLES);
  const pts = SAMPLES.map((v, i) => {
    const x = PAD + (i / (n - 1)) * (W - PAD * 2);
    const y = H - PAD - (v / max) * (H - PAD * 2);
    return [x, y] as const;
  });
  const line = pts
    .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ');
  const area = `${line} L${(W - PAD).toFixed(1)} ${H - PAD} L${PAD} ${H - PAD} Z`;
  const revealW = (PAD + progress * (W - PAD * 2)).toFixed(1);
  return (
    <svg
      class="hx-chart"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="hx-chart-fill" x1="0" y1="0" x2="0" y2="1">
          <stop class="hx-chart__stop-a" offset="0%" />
          <stop class="hx-chart__stop-b" offset="100%" />
        </linearGradient>
        <clipPath id="hx-chart-clip">
          <rect x="0" y="0" width={revealW} height={H} />
        </clipPath>
      </defs>
      <path class="hx-chart__area" d={area} clip-path="url(#hx-chart-clip)" />
      <path
        class="hx-chart__line"
        d={line}
        clip-path="url(#hx-chart-clip)"
        vector-effect="non-scaling-stroke"
      />
      <line
        class="hx-chart__now"
        x1={revealW}
        y1={PAD}
        x2={revealW}
        y2={H - PAD}
        vector-effect="non-scaling-stroke"
      />
    </svg>
  );
}

export function ChapterStreaming(): VNode {
  return (
    <section class="hx-chapter">
      <ScrollStage
        pages={2.6}
        pagesNarrow={2}
        fallbackProgress={1}
        label="Streaming loader feed"
      >
        <div class="hx-scene">
          <div class="hx-scene__head">
            <p class="hx-scene__step">
              <span class="hx-scene__num">03</span>Stream
            </p>
            <h2 class="hx-scene__title">Data that streams in.</h2>
            <p class="hx-scene__desc">
              A loader can be an async generator. Each value it yields streams
              over SSE, or inlines during SSR, and folds into the live UI the
              moment it lands.
            </p>
          </div>

          <div class="hx-panels hx-cols2">
            <BrowserFrame url="/demo/projects/:projectId/tasks/:taskId" live>
              <div class="hx-stream">
                <LiveCount />
                <Region
                  showAt={0.37}
                  skeleton={<div class="hx-skel hx-skel--list" />}
                >
                  <ul class="hx-stream__list">
                    <li class="hx-stream__item">Ship the streaming loader</li>
                    <li class="hx-stream__item">
                      Fold snapshots in order of arrival
                    </li>
                    <li class="hx-stream__item">Reconnect on drop</li>
                  </ul>
                </Region>
                <Region
                  showAt={0.9}
                  skeleton={<div class="hx-skel hx-skel--head" />}
                >
                  <header class="hx-stream__header">
                    <span class="hx-stream__dot" aria-hidden="true" />
                    Live feed: open
                  </header>
                </Region>
                <Region
                  showAt={0.6}
                  skeleton={<div class="hx-skel hx-skel--chart" />}
                >
                  <figure class="hx-stream__chart">
                    <figcaption class="hx-stream__chart-cap">
                      Throughput
                      <span class="hx-stream__chart-trend">trending up</span>
                    </figcaption>
                    <StreamChart />
                  </figure>
                </Region>
              </div>
            </BrowserFrame>

            <Wire caption="network: SSE">
              <Lane label="GET /feed" start={0} size={0.1} tone="grad" />
              <Lane label="list" start={0.12} size={0.25} />
              <Lane label="header" start={0.1} size={0.8} />
              <Lane label="chart" start={0.14} size={0.46} />
            </Wire>
          </div>

          <pre class="hx-scene__code">
            <Code source={FEED_SNIPPET} />
          </pre>
        </div>
      </ScrollStage>
      {/* Phone-only copy of the code (see .hx-chapter__coda). */}
      <div class="hx-chapter__coda">
        <pre class="hx-scene__code">
          <Code source={FEED_SNIPPET} />
        </pre>
      </div>
    </section>
  );
}
