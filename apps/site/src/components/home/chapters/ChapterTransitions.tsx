import { useState } from 'preact/hooks';
import type { VNode } from 'preact';
import { usePrefersReducedMotion } from '../scroll/motion.js';
import { BrowserFrame } from '../scroll/primitives.js';

type Card = { id: string; title: string; meta: string; body: string };

const CARDS: Card[] = [
  {
    id: 'auth',
    title: 'Ship the auth flow',
    meta: 'Web, In progress',
    body: 'Wire the session cookie, gate the dashboard, and add the sign-out route.',
  },
  {
    id: 'search',
    title: 'Fix search ranking',
    meta: 'API, In review',
    body: 'Boost exact-title matches and de-duplicate results before paging.',
  },
  {
    id: 'billing',
    title: 'Draft the billing page',
    meta: 'Web, Backlog',
    body: 'Lay out the plan cards, wire the upgrade action, and show the invoice list.',
  },
];

const DESC =
  'hono-preact wraps every client route change in a view transition automatically: no per-link opt-in, direction-aware slides, and shared-element morphs where a card grows into the page. Try it here, then feel the real thing in the demo.';

// Stored as plain single-quoted lines (not a template literal) so the backticks
// and the `${task.id}` interpolation stay literal in the rendered code sample.
const SNIPPET = [
  '// You write nothing: every client route change is wrapped in a view',
  '// transition automatically. You do not opt in.',
  '//',
  '// Direction-aware, in CSS (framework adds nav-back / nav-forward types):',
  '//   :active-view-transition-type(nav-back) ::view-transition-old(root) {',
  '//     animation: slide-right-out 0.3s ease;',
  '//   }',
  '//',
  '// Morph a card into its detail page (shared element):',
  '//   <ViewTransitionName name={`task-${task.id}`} render={<header />}>',
  '//     <h1>{task.title}</h1>',
  '//   </ViewTransitionName>',
].join('\n');

export function ChapterTransitions(): VNode {
  const reduced = usePrefersReducedMotion();
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dir, setDir] = useState<'forward' | 'back'>('forward');

  function go(next: 'list' | 'detail', id: string | null) {
    const nextDir: 'forward' | 'back' = next === 'detail' ? 'forward' : 'back';
    const apply = () => {
      setDir(nextDir);
      setSelectedId(id);
      setView(next);
    };
    // Real view transition only when the platform supports it AND motion is
    // allowed; otherwise flip state directly so the widget stays fully usable.
    const canAnimate =
      !reduced &&
      typeof document !== 'undefined' &&
      typeof document.startViewTransition === 'function';
    if (canAnimate) {
      // Drives the direction-aware ::view-transition slide in home.css.
      document.documentElement.setAttribute('data-hx-dir', nextDir);
      const transition = document.startViewTransition(async () => {
        apply();
        // Let Preact commit before the browser snapshots the "new" state.
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });
      });
      transition.finished.finally(() => {
        document.documentElement.removeAttribute('data-hx-dir');
      });
    } else {
      apply();
    }
  }

  const selected = CARDS.find((c) => c.id === selectedId) ?? null;

  return (
    <section class="hx-chapter">
      <div class="hx-scene__head">
        <p class="hx-scene__step">Signature</p>
        <h2 class="hx-scene__title">Transitions, for free.</h2>
        <p class="hx-scene__desc">{DESC}</p>
      </div>

      <div class="hx-cols2">
        <BrowserFrame url="/demo/projects">
          {/* data-dir is declared here for readers; the global ::view-transition
              pseudo-elements are keyed off html[data-hx-dir] set during go(). */}
          <div class="hx-vt" data-dir={dir}>
            {view === 'list' || selected === null ? (
              <ul class="hx-vt__list">
                {CARDS.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      class="hx-vt__card"
                      style={{
                        viewTransitionName: reduced
                          ? undefined
                          : `hx-card-${c.id}`,
                        minHeight: 44,
                      }}
                      onClick={() => go('detail', c.id)}
                    >
                      <span class="hx-vt__card-title">{c.title}</span>
                      <span class="hx-vt__card-meta">{c.meta}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div class="hx-vt__detail">
                <div
                  class="hx-vt__hero"
                  style={{
                    viewTransitionName: reduced
                      ? undefined
                      : `hx-card-${selected.id}`,
                  }}
                >
                  <span class="hx-vt__card-title">{selected.title}</span>
                  <span class="hx-vt__card-meta">{selected.meta}</span>
                </div>
                <p class="hx-vt__body">{selected.body}</p>
                <button
                  type="button"
                  class="hx-vt__back"
                  style={{ minHeight: 44 }}
                  onClick={() => go('list', null)}
                >
                  Back to projects
                </button>
              </div>
            )}
          </div>
        </BrowserFrame>

        <div class="hx-panels">
          <pre class="hx-code">
            <code>{SNIPPET}</code>
          </pre>
          <p class="hx-scene__desc">
            This widget calls <code>document.startViewTransition</code> by hand.
            hono-preact does exactly this for you on every client navigation: no
            opt-in, direction-aware, with shared-element morphs.
          </p>
          <a class="hx-vt__demo" href="/demo/projects">
            Feel the real thing in the demo
          </a>
        </div>
      </div>
    </section>
  );
}
