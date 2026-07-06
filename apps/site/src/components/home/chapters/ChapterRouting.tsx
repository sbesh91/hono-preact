import type { VNode } from 'preact';
import { useState } from 'preact/hooks';
import { ScrollStage, useStageProgress } from '../scroll/stage.js';
import { BrowserFrame } from '../scroll/primitives.js';
import { Code } from '../scroll/code.js';

const NODES = ['Root', 'Section', 'List', 'Detail'] as const;

const SNIPPET = `defineRoutes([
  { path: '/projects', layout, children: [
    { path: ':id', view },
  ] },
]);`;

// Inner child: reads the pinned playhead and maps it to an active route node.
// Outer boxes (Root, Section, List) stay mounted while the inner box swaps,
// which is exactly what a nested-layout manifest does at runtime.
function RouteStack(): VNode {
  const { progress } = useStageProgress();
  const scrubIndex = Math.min(3, Math.floor(progress * 4));
  const [override, setOverride] = useState<number | null>(null);
  const active = override ?? scrubIndex;

  return (
    <div class="hx-route">
      <div class="hx-route__tabs" role="group" aria-label="Route nodes">
        {NODES.map((label, i) => (
          <button
            key={label}
            type="button"
            class="hx-route__pill"
            data-active={i === active ? '' : undefined}
            aria-pressed={i === active}
            onClick={() => setOverride(i)}
            onFocus={() => setOverride(i)}
          >
            {label}
          </button>
        ))}
      </div>
      <BrowserFrame url="example.app / projects / 102000">
        <div class="hx-route__stack">
          {NODES.map((label, i) => (
            <div
              key={label}
              class="hx-route__box"
              data-active={i === active ? '' : undefined}
            >
              <span class="hx-route__box-label">{label}</span>
              {i === active ? (
                <span class="hx-route__box-tag">active</span>
              ) : null}
            </div>
          ))}
        </div>
      </BrowserFrame>
    </div>
  );
}

export function ChapterRouting(): VNode {
  return (
    <section class="hx-chapter">
      <ScrollStage
        pages={3}
        pagesNarrow={2}
        unpinOnNarrow
        label="Routing is a manifest"
      >
        <div class="hx-scene">
          <div class="hx-scene__head">
            <p class="hx-scene__step">Routing</p>
            <h2 class="hx-scene__title">Routing is a manifest.</h2>
            <p class="hx-scene__desc">
              Your routes are a data structure, not a folder tree. Nested
              layouts stay mounted while their child swaps, and every node owns
              its own data and is code-split.
            </p>
          </div>
          <RouteStack />
          <pre class="hx-route__code">
            <Code source={SNIPPET} />
          </pre>
        </div>
      </ScrollStage>
    </section>
  );
}
