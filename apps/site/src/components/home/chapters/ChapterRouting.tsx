import type { VNode } from 'preact';
import { ScrollStage, useStageProgress } from '../scroll/stage.js';
import { BrowserFrame } from '../scroll/primitives.js';
import { Code } from '../scroll/code.js';

// Each layer is a mounted layout that owns its own data and is code-split. As
// the scrub drills deeper (root -> project -> task) the outer layouts stay
// mounted while a new child mounts inside them; only the innermost node swaps.
// That containment is the "routes are a manifest, not a folder tree" point.
const LAYERS = [
  { name: 'Root layout', role: 'app shell', seg: null },
  { name: 'Projects layout', role: 'sidebar', seg: 'projects' },
  { name: 'Project layout', role: 'tabs', seg: 'acme' },
  { name: 'Task view', role: 'detail', seg: '102000' },
] as const;

const SNIPPET = `defineRoutes([
  { path: '/', layout: Shell, children: [
    { path: 'projects/:id', layout: Project, children: [
      { path: 'tasks/:taskId', view: Task },
    ] },
  ] },
]);`;

// The whole nested manifest is always on screen (no layers appear or collapse,
// so nothing clips or jumps). `active` is the deepest node the URL has reached;
// scrolling just moves the accent highlight down the tree. Nodes above it are
// mounted parent layouts that stay put; nodes below it are code-split routes not
// loaded yet. Only colors transition, so the reveal is smooth both directions.
function RouteLayer({
  i,
  active,
}: {
  i: number;
  active: number;
}): VNode | null {
  if (i >= LAYERS.length) return null;
  const layer = LAYERS[i];
  const isView = i === LAYERS.length - 1;
  const state = i < active ? 'mounted' : i === active ? 'active' : 'pending';
  const role =
    state === 'active'
      ? isView
        ? 'active view · owns its data'
        : 'active'
      : state === 'mounted'
        ? `${layer.role} · stays mounted`
        : 'code-split · loads on demand';
  return (
    <div class="hx-route__layer" data-state={state}>
      <div class="hx-route__layer-head">
        <span class="hx-route__layer-name">{layer.name}</span>
        <span class="hx-route__layer-role">{role}</span>
      </div>
      {isView ? (
        <div class="hx-route__view-body" aria-hidden="true">
          <span class="hx-route__view-row" />
          <span class="hx-route__view-row hx-route__view-row--short" />
        </div>
      ) : (
        <RouteLayer i={i + 1} active={active} />
      )}
    </div>
  );
}

// Reads the pinned playhead and moves the active node one layer deeper per
// quarter of the scrub, growing the URL breadcrumb in step.
function RouteStack(): VNode {
  const { progress } = useStageProgress();
  const active = Math.min(
    LAYERS.length - 1,
    Math.floor(progress * LAYERS.length)
  );
  const url =
    'example.app' +
    LAYERS.slice(0, active + 1)
      .filter((l) => l.seg)
      .map((l) => ` / ${l.seg}`)
      .join('');
  return (
    <div class="hx-route">
      <BrowserFrame url={url}>
        <div class="hx-route__nest">
          <RouteLayer i={0} active={active} />
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
            <p class="hx-scene__step">
              <span class="hx-scene__num">01</span>Routing
            </p>
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
