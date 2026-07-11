import type { VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ScrollStage, useStageProgress } from '../scroll/stage.js';
import { BrowserFrame, Wire, Lane } from '../scroll/primitives.js';
import { Code } from '../scroll/code.js';

const SNIPPET = `serverLoaders.default.View((state) => {
  switch (state.status) {
    case 'loading': return <Skeleton />;
    case 'revalidating': // keeps the last value
    case 'success': return <List items={state.data} />;
    case 'error': return <Retry onRetry={useReload().reload} />;
  }
});`;

type Status = 'loading' | 'success' | 'revalidating' | 'error';

// Status windows across the stage playhead: loading < .25, success < .5,
// revalidating < .75, else error. During revalidating the last value stays
// on screen; at error a single pane flips to a contained error boundary.
function statusFor(progress: number): Status {
  if (progress < 0.25) return 'loading';
  if (progress < 0.5) return 'success';
  if (progress < 0.75) return 'revalidating';
  return 'error';
}

// Inner child: reads the stage playhead to drive the status chip and to flip
// exactly one pane to a contained error boundary once the playhead reaches the
// error window. The other two panes stay intact, which is the whole point.
const NOTE: Record<Status, string> = {
  loading: 'fetching the first frame',
  success: 'fresh data',
  revalidating: 'keeps the last good value while it refetches',
  error: 'one pane failed, the rest stayed up',
};

// The chapter's namesake moment: one pane fails while its siblings keep
// rendering. It was a silent DOM swap (Preact mounts a wholly different
// subtree, so there's no keyframe to retarget); this arms a one-frame-delayed
// `data-entered` flag so CSS can transition it in each time the playhead
// crosses into the error window, mirroring the same armed-mount pattern
// `Reveal` and `ChapterOnePackage` already use for their own entrances.
function ErrorPane(): VNode {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div
      class="hx-res__pane hx-res__pane--error"
      data-entered={entered ? '' : undefined}
      role="status"
    >
      <span class="hx-res__pane-head">Tasks</span>
      <div class="hx-res__pane-fail">
        <span>Failed to load</span>
        <span class="hx-res__retry">Retry</span>
      </div>
    </div>
  );
}

function ResilienceApp(): VNode {
  const { progress } = useStageProgress();
  const status = statusFor(progress);
  const loading = status === 'loading';
  const errored = status === 'error';
  // Each surviving pane keeps its data rows; only the errored pane swaps to a
  // contained boundary, which is the whole point of the chapter.
  const body = () => (
    <div class="hx-res__pane-body" data-loading={loading ? '' : undefined}>
      <span class="hx-res__row" />
      <span class="hx-res__row hx-res__row--short" />
    </div>
  );
  return (
    <div class="hx-res">
      <div class="hx-res__bar">
        <span class="hx-res__chip" data-state={status}>
          {status}
        </span>
        <span class="hx-res__note">{NOTE[status]}</span>
      </div>
      <div class="hx-res__panes">
        <div class="hx-res__pane">
          <span class="hx-res__pane-head">Overview</span>
          {body()}
        </div>
        {errored ? (
          <ErrorPane />
        ) : (
          <div class="hx-res__pane">
            <span class="hx-res__pane-head">Tasks</span>
            {body()}
          </div>
        )}
        <div class="hx-res__pane">
          <span class="hx-res__pane-head">Activity</span>
          {body()}
        </div>
      </div>
    </div>
  );
}

export function ChapterResilience(): VNode {
  return (
    <section class="hx-chapter">
      <ScrollStage
        pages={2.4}
        pagesNarrow={2}
        fallbackProgress={0.6}
        label="Resilience: match on loading, revalidating, and error"
      >
        <div class="hx-scene">
          <div class="hx-scene__head">
            <p class="hx-scene__step">
              <span class="hx-scene__num">05</span>Resilience
            </p>
            <h2 class="hx-scene__title">Built to degrade, not crash.</h2>
            <p class="hx-scene__desc">
              Loading, revalidating, and error are a discriminated union you
              match on: stale-while-revalidate and keep-last-good-value are the
              default, and a route error boundary contains a failure to its own
              pane.
            </p>
          </div>
          <div class="hx-panels">
            <pre class="hx-res__code">
              <Code source={SNIPPET} />
            </pre>
            <div class="hx-panel">
              <BrowserFrame url="/demo/projects/:projectId/tasks/:taskId">
                <ResilienceApp />
              </BrowserFrame>
              <Wire caption="reload()">
                <Lane label="reload()" start={0.75} size={0.2} tone="accent" />
              </Wire>
            </div>
          </div>
        </div>
      </ScrollStage>
    </section>
  );
}
