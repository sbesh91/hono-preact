import type { VNode } from 'preact';
import { ScrollStage, useStageProgress } from '../scroll/stage.js';
import { BrowserFrame, Region, Wire, Lane } from '../scroll/primitives.js';

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

export function ChapterStreaming(): VNode {
  return (
    <section class="hx-chapter">
      <div class="hx-scene__head">
        <p class="hx-scene__step">RPC 02 / Stream</p>
        <h2 class="hx-scene__title">Data that streams in.</h2>
        <p class="hx-scene__desc">
          A loader can be an async generator. Each yield frames over SSE (or is
          SSR-pumped inline) and folds into live UI as it lands.
        </p>
      </div>

      <pre class="hx-scene__code">
        <code>{FEED_SNIPPET}</code>
      </pre>

      <ScrollStage
        pages={2.6}
        pagesNarrow={2}
        fallbackProgress={1}
        label="Streaming loader feed"
      >
        <div class="hx-panels hx-cols2">
          <BrowserFrame url="/demo/projects/:projectId/tasks/:taskId" live>
            <div class="hx-stream">
              <LiveCount />
              <Region
                showAt={0.35}
                skeleton={<div class="hx-skel hx-skel--list" />}
              >
                <ul class="hx-stream__list">
                  <li>Ship the streaming loader</li>
                  <li>Fold snapshots in order of arrival</li>
                  <li>Reconnect on drop</li>
                </ul>
              </Region>
              <Region
                showAt={0.62}
                skeleton={<div class="hx-skel hx-skel--head" />}
              >
                <header class="hx-stream__header">Live feed: open</header>
              </Region>
              <Region
                showAt={0.92}
                skeleton={<div class="hx-skel hx-skel--chart" />}
              >
                <div class="hx-stream__chart">Throughput trending up</div>
              </Region>
            </div>
          </BrowserFrame>

          <Wire caption="network: SSE">
            <Lane label="GET /feed" start={0} size={0.1} tone="grad" />
            <Lane label="list" start={0.12} size={0.25} />
            <Lane label="header" start={0.1} size={0.5} />
            <Lane label="chart" start={0.14} size={0.76} />
          </Wire>
        </div>
      </ScrollStage>
    </section>
  );
}
