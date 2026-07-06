import type { VNode } from 'preact';
import { BrowserFrame } from '../scroll/primitives.js';
import { Code } from '../scroll/code.js';

const DESC =
  'hono-preact wraps every client route change in a view transition automatically: no per-link opt-in, direction-aware slides, and shared-element morphs where a card grows into the page it opens.';

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
          {/* Faked, illustrative: the highlighted list card is the same shared
              element as the detail hero, so it reads as one morph. */}
          <div class="hx-vt2__flow" aria-hidden="true">
            <BrowserFrame url="/demo/projects">
              <ul class="hx-vt2__list">
                <li class="hx-vt2__row hx-vt2__row--morph">
                  <span class="hx-vt2__row-title">Ship the auth flow</span>
                  <span class="hx-vt2__row-meta">Web</span>
                </li>
                <li class="hx-vt2__row">Fix search ranking</li>
                <li class="hx-vt2__row">Draft the billing page</li>
              </ul>
            </BrowserFrame>

            <div class="hx-vt2__arrow">
              <span class="hx-vt2__arrow-label">morphs into</span>
              <svg viewBox="0 0 40 12" width="40" height="12">
                <path
                  d="M0 6 H34 M28 1 L34 6 L28 11"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                />
              </svg>
            </div>

            <BrowserFrame url="/demo/projects/auth">
              <div class="hx-vt2__hero hx-vt2__row--morph">
                <span class="hx-vt2__hero-title">Ship the auth flow</span>
                <span class="hx-vt2__row-meta">Web · In progress</span>
              </div>
              <p class="hx-vt2__body">
                The tapped card grows into the page header while the list slides
                out beneath it, all from one shared name.
              </p>
            </BrowserFrame>
          </div>

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
