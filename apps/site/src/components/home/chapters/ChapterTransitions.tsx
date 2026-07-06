import { useState } from 'preact/hooks';
import type { VNode } from 'preact';
import { BrowserFrame } from '../scroll/primitives.js';
import { Code } from '../scroll/code.js';

const DESC =
  'hono-preact wraps every client route change in a view transition automatically: no per-link opt-in, direction-aware slides, and shared-element morphs where a card grows into the page it opens. Open the card below to watch it.';

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

// A user-driven, faked-but-real shared-element morph: opening the detail flips
// --m to 1 and CSS transitions the accent card from a list row into the page
// header (sibling rows collapse, detail body fades in). No autoplay loop; the
// reader controls it and reduced motion drops the animation to an instant swap.
function MorphDemo(): VNode {
  const [open, setOpen] = useState(false);
  return (
    <div class="hx-vt2__demo">
      <BrowserFrame url={open ? '/demo/projects/auth' : '/demo/projects'}>
        <div class="hx-morph" style={{ '--m': open ? 1 : 0 }}>
          <div class="hx-morph__hero">
            <span class="hx-morph__title">Ship the auth flow</span>
            <span class="hx-morph__meta">
              {open ? 'Web · In progress' : 'Web'}
            </span>
          </div>
          <div class="hx-morph__rest" aria-hidden={open ? 'true' : undefined}>
            <div class="hx-morph__row">Fix search ranking</div>
            <div class="hx-morph__row">Draft the billing page</div>
          </div>
          <p class="hx-morph__body" aria-hidden={open ? undefined : 'true'}>
            The tapped card grew into the page header. One shared name, no
            hand-written animation.
          </p>
        </div>
      </BrowserFrame>
      <button
        type="button"
        class="hx-morph__toggle"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? '← Back to the list' : 'Open the detail page →'}
      </button>
    </div>
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
          <MorphDemo />

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
