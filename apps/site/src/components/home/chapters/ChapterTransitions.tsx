import type { VNode } from 'preact';
import { LiveStage, useStageProgress } from '../scroll/stage.js';
import { BrowserFrame } from '../scroll/primitives.js';
import { Code } from '../scroll/code.js';

const DESC =
  'hono-preact wraps every client route change in a view transition automatically: no per-link opt-in, direction-aware slides, and shared-element morphs where a card grows into the page it opens. Watch it play below.';

// Stored as plain single-quoted lines (not a template literal) so the backticks
// and the `${task.id}` interpolation stay literal in the rendered code sample.
const SNIPPET = [
  '// You write nothing: every client route change is wrapped in a view',
  '// transition automatically. You do not opt in.',
  '//',
  '// Direction-aware, in CSS (framework adds nav-back / nav-forward types):',
  '//   html:active-view-transition-type(nav-back)::view-transition-old(root) {',
  '//     animation: slide-right-out 0.3s ease;',
  '//   }',
  '//',
  '// Morph a card into its detail page (shared element):',
  '//   <ViewTransitionName name={`task-${task.id}`} render={<header />}>',
  '//     <h1>{task.title}</h1>',
  '//   </ViewTransitionName>',
].join('\n');

const IDEAS: { lead: string; body: string }[] = [
  {
    lead: 'Automatic',
    body: 'Every client route change is wrapped in a view transition. No per-link opt-in, nothing to remember.',
  },
  {
    lead: 'Direction-aware',
    body: 'Forward navigations slide left, back slides right, keyed off nav types the framework adds for you.',
  },
  {
    lead: 'Shared-element morph',
    body: 'Tag an element with one name and it morphs from its list card straight into the detail page header.',
  },
];

// Shape the looping LiveStage clock (a 0..1 sawtooth) into a morph amount that
// eases into the detail page, holds, eases back to the list, and holds, so the
// card visibly grows into the header and back rather than snapping at the loop.
function morphAmount(p: number): number {
  if (p < 0.35) return p / 0.35; // list -> detail
  if (p < 0.55) return 1; // hold on the detail page
  if (p < 0.85) return 1 - (p - 0.55) / 0.3; // detail -> list
  return 0; // hold on the list
}

// Reads the LiveStage playhead and drives a faked-but-real shared-element morph:
// the accent card grows from a list row into the page header while the sibling
// rows collapse and the detail body fades in. Everything derives from --m.
function MorphDemo(): VNode {
  const { progress } = useStageProgress();
  const m = morphAmount(progress);
  const onDetail = m > 0.5;
  return (
    <BrowserFrame
      url={onDetail ? '/demo/projects/auth' : '/demo/projects'}
      live
    >
      <div class="hx-morph" style={{ '--m': m.toFixed(3) }}>
        {/* The shared element: same accent card in both states. */}
        <div class="hx-morph__hero">
          <span class="hx-morph__title">Ship the auth flow</span>
          <span class="hx-morph__meta">
            {onDetail ? 'Web · In progress' : 'Web'}
          </span>
        </div>
        {/* Sibling rows collapse away as the card grows. */}
        <div class="hx-morph__rest" aria-hidden="true">
          <div class="hx-morph__row">Fix search ranking</div>
          <div class="hx-morph__row">Draft the billing page</div>
        </div>
        {/* Detail body arrives once the morph settles. */}
        <p class="hx-morph__body">
          The tapped card grew into the page header. One shared name, no
          hand-written animation.
        </p>
      </div>
    </BrowserFrame>
  );
}

export function ChapterTransitions(): VNode {
  return (
    <section class="hx-chapter">
      <div class="hx-scene">
        <div class="hx-scene__head">
          <p class="hx-scene__step">Signature</p>
          <h2 class="hx-scene__title">Transitions, for free.</h2>
          <p class="hx-scene__desc">{DESC}</p>
        </div>

        <div class="hx-vt2">
          <LiveStage periodMs={5200} fallbackProgress={0.45}>
            <div class="hx-vt2__demo">
              <MorphDemo />
            </div>
          </LiveStage>

          <ul class="hx-why">
            {IDEAS.map((i) => (
              <li key={i.lead} class="hx-why__item">
                <b class="hx-why__lead">{i.lead}</b>
                <span class="hx-why__body">{i.body}</span>
              </li>
            ))}
          </ul>
        </div>

        <pre class="hx-code">
          <Code source={SNIPPET} />
        </pre>
        <a class="hx-vt__demo" href="/demo/projects">
          Feel the real thing in the demo
        </a>
      </div>
    </section>
  );
}
