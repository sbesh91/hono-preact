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

// Renders layer i nested inside its parent, then recurses into its child. Outer
// layers render their persistent chrome; the deepest one is the active node.
function RouteLayer({ i, depth }: { i: number; depth: number }): VNode | null {
  if (i >= depth) return null;
  const layer = LAYERS[i];
  const isLeaf = i === depth - 1;
  const isView = i === LAYERS.length - 1;
  return (
    <div
      class="hx-route__layer"
      data-leaf={isLeaf ? '' : undefined}
      data-view={isView && isLeaf ? '' : undefined}
    >
      <div class="hx-route__layer-head">
        <span class="hx-route__layer-name">{layer.name}</span>
        <span class="hx-route__layer-role">
          {isLeaf
            ? isView
              ? 'active view · owns its data'
              : 'child mounts here'
            : `${layer.role} · stays mounted`}
        </span>
      </div>
      {isView && isLeaf ? (
        <div class="hx-route__view-body" aria-hidden="true">
          <span class="hx-route__view-row" />
          <span class="hx-route__view-row hx-route__view-row--short" />
        </div>
      ) : (
        <RouteLayer i={i + 1} depth={depth} />
      )}
    </div>
  );
}

// Reads the pinned playhead and drills one layer deeper per quarter of the
// scrub, growing the URL breadcrumb in step with the nesting.
function RouteStack(): VNode {
  const { progress } = useStageProgress();
  const depth = Math.min(
    LAYERS.length,
    Math.floor(progress * LAYERS.length) + 1
  );
  const url =
    'example.app' +
    LAYERS.slice(0, depth)
      .filter((l) => l.seg)
      .map((l) => ` / ${l.seg}`)
      .join('');
  return (
    <div class="hx-route">
      <BrowserFrame url={url}>
        <div class="hx-route__nest">
          <RouteLayer i={0} depth={depth} />
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
