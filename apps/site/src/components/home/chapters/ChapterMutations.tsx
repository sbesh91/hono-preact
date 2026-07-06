import type { VNode } from 'preact';
import { ScrollStage } from '../scroll/stage.js';
import { BrowserFrame, Region, Wire, Lane } from '../scroll/primitives.js';
import { Code } from '../scroll/code.js';

const TITLE = 'Mutations without the cliff.';
const DESC =
  'A mutation is a Form plus defineAction. The UI patches the instant you submit and the server reconciles behind it. Watch the list fill before the network settles, then read why that is worth doing.';

// Payoff points, each tied to a moment in the demo above.
const WHY: { lead: string; body: string }[] = [
  {
    lead: 'Optimistic',
    body: 'The new row appears the instant you submit, then reconciles when the server responds. No spinner, no dead time.',
  },
  {
    lead: 'Race-safe',
    body: 'Submit again before the first finishes and the in-flight request is aborted, so you never write a duplicate.',
  },
  {
    lead: 'Revalidate by reference',
    body: 'The action re-runs exactly the loaders it invalidates. No cache keys to name, nothing stale left on screen.',
  },
  {
    lead: 'Progressive',
    body: 'It is a real Form bound to the action, so the same markup still submits with JavaScript disabled.',
  },
];

const SNIPPET = `const { mutate, pending } = useAction(serverActions.addTask, {
  invalidate: 'auto',
  onMutate: (t) => addOptimistic(t),
  onError: (_e, h) => h.revert(),
});
// <Form action={serverActions.addTask}> also works with JavaScript disabled`;

export function ChapterMutations(): VNode {
  return (
    <section class="hx-chapter">
      <ScrollStage
        pages={3}
        pagesNarrow={2}
        unpinOnNarrow
        label="Mutation lifecycle"
      >
        <div class="hx-scene">
          <header class="hx-scene__head">
            <p class="hx-scene__step">
              <span class="hx-scene__num">04</span>Action
            </p>
            <h2 class="hx-scene__title">{TITLE}</h2>
            <p class="hx-scene__desc">{DESC}</p>
          </header>
          <div class="hx-panels">
            <BrowserFrame url="/projects/acme">
              <div class="hx-mut-form">
                <span class="hx-mut-input">Design the landing hero</span>
                <button type="button" class="hx-mut-add">
                  Add
                </button>
              </div>
              {/* A plain container, not <ul>/<li>: the Region wrappers sit
                  between the rows, which would break real list semantics and
                  fail the a11y list/listitem checks. */}
              <div class="hx-mut-list">
                <div class="hx-mut-row">Wire up the RPC client</div>
                <Region
                  showAt={0.2}
                  skeleton={
                    <div
                      class="hx-mut-row hx-mut-row--pending"
                      aria-hidden="true"
                    />
                  }
                >
                  <div class="hx-mut-row hx-mut-row--optimistic">
                    <span>Design the landing hero</span>
                    <span class="hx-mut-tag">saving</span>
                  </div>
                </Region>
                <Region
                  showAt={0.85}
                  skeleton={
                    <div
                      class="hx-mut-row hx-mut-row--pending"
                      aria-hidden="true"
                    />
                  }
                >
                  <div class="hx-mut-row hx-mut-row--saved">
                    <span>Design the landing hero</span>
                    <span class="hx-mut-tag hx-mut-tag--ok">saved</span>
                  </div>
                </Region>
              </div>
            </BrowserFrame>
            <Wire caption="network: mutation + revalidate">
              <Lane
                label="POST /projects"
                start={0.05}
                size={0.32}
                tone="accent"
              />
              <Lane
                label="POST (dup)"
                start={0.16}
                size={0.2}
                cancelAt={0.34}
              />
              <Lane
                label="POST /__loaders"
                start={0.5}
                size={0.34}
                tone="grad"
              />
            </Wire>
          </div>
          <ul class="hx-why">
            {WHY.map((w) => (
              <li key={w.lead} class="hx-why__item">
                <b class="hx-why__lead">{w.lead}</b>
                <span class="hx-why__body">{w.body}</span>
              </li>
            ))}
          </ul>
          <pre class="hx-code">
            <Code source={SNIPPET} />
          </pre>
        </div>
      </ScrollStage>
    </section>
  );
}
