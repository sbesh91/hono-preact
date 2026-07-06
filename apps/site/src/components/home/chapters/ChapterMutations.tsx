import type { VNode } from 'preact';
import { ScrollStage } from '../scroll/stage.js';
import {
  BrowserFrame,
  Region,
  Wire,
  Lane,
  Reveal,
} from '../scroll/primitives.js';

const STEP = 'RPC 03 / Action';
const TITLE = 'Mutations without the cliff.';
const DESC =
  'A mutation is a Form plus defineAction. The UI patches instantly, the server runs, a resubmission race is cancelled, then loaders revalidate by reference. The same markup works with JS off.';

const SNIPPET = `const { mutate, pending } = useAction(serverActions.addTask, {
  invalidate: 'auto',
  onMutate: (t) => addOptimistic(t),
  onError: (_e, h) => h.revert(),
});
// <Form action={serverActions.addTask}> also works with JavaScript disabled`;

export function ChapterMutations(): VNode {
  return (
    <section class="hx-chapter">
      <div class="hx-scene">
        <header class="hx-scene__head">
          <p class="hx-scene__step">{STEP}</p>
          <h2 class="hx-scene__title">{TITLE}</h2>
          <p class="hx-scene__desc">{DESC}</p>
        </header>
        <div class="hx-panels hx-cols2">
          <ScrollStage pages={3} pagesNarrow={2} label="Mutation lifecycle">
            <BrowserFrame url="/projects/acme">
              <div class="hx-mut-form">
                <span class="hx-mut-input">Design the landing hero</span>
                <button type="button" class="hx-mut-add">
                  Add
                </button>
              </div>
              <ul class="hx-mut-list">
                <li class="hx-mut-row">Wire up the RPC client</li>
                <Region
                  showAt={0.2}
                  skeleton={
                    <li
                      class="hx-mut-row hx-mut-row--pending"
                      aria-hidden="true"
                    />
                  }
                >
                  <li class="hx-mut-row hx-mut-row--optimistic">
                    <span>Design the landing hero</span>
                    <span class="hx-mut-tag">saving</span>
                  </li>
                </Region>
                <Region
                  showAt={0.85}
                  skeleton={
                    <li
                      class="hx-mut-row hx-mut-row--pending"
                      aria-hidden="true"
                    />
                  }
                >
                  <li class="hx-mut-row hx-mut-row--saved">
                    <span>Design the landing hero</span>
                    <span class="hx-mut-tag hx-mut-tag--ok">saved</span>
                  </li>
                </Region>
              </ul>
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
          </ScrollStage>
          <Reveal>
            <pre class="hx-code">
              <code>{SNIPPET}</code>
            </pre>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
