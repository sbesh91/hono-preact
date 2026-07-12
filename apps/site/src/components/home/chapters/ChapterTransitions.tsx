import type { VNode } from 'preact';
import { ScrollStage, useStageValue } from '../scroll/stage.js';
import { BrowserFrame } from '../scroll/primitives.js';
import { clamp01 } from '../scroll/progress.js';

const DESC =
  'Every client route change gets a view transition, automatically. No per-link opt-in, no keyframes to hand-write.';

const IDEAS: { lead: string; body: string }[] = [
  {
    lead: 'Automatic',
    body: 'The router wraps every client route change in a view transition. No per-link opt-in, nothing to remember.',
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

/** The morph's own 0..1, a window of the stage playhead. CSS derives the same
 *  value from --hx-p (see .hx-vt2__demo); this mirrors it for the one thing CSS
 *  cannot do here, which is swap the URL and the labels at the halfway point. */
const morphAmount = (progress: number): number =>
  clamp01((progress - 0.08) / 0.78);

// Scroll scrubs a faked-but-real shared-element morph: --m tracks the stage
// playhead, so the accent card grows from a list row into the page header as
// you scroll (sibling rows collapse, the detail body fades in). The morph itself
// is pure CSS off the playhead, so scrubbing it costs no render; only the
// halfway flip below does. No autoplay and no button; the reader drives it with
// scroll, and reduced motion / no-JS render the settled (morphed) state via the
// stage fallback.
function MorphDemo(): VNode {
  const open = useStageValue((progress) => morphAmount(progress) > 0.5);
  return (
    <div class="hx-vt2__demo">
      {/* An explicit scrubber up top makes it obvious the pinned scroll is
          driving the morph: the label names the interaction and the fill tracks
          progress. */}
      <div class="hx-morph__scrub" aria-hidden="true">
        <span class="hx-morph__scrub-label">
          {open
            ? 'One shared name, no keyframes'
            : 'Scroll to morph the card into its page ↓'}
        </span>
        <div class="hx-morph__scrub-track">
          <div class="hx-morph__scrub-fill" />
        </div>
      </div>
      <BrowserFrame url={open ? '/demo/projects/auth' : '/demo/projects'}>
        <div class="hx-morph">
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
    </div>
  );
}

export function ChapterTransitions(): VNode {
  return (
    <section class="hx-chapter">
      <ScrollStage
        pages={1.8}
        pagesNarrow={2}
        fallbackProgress={0.9}
        label="View transition morph"
      >
        <div class="hx-scene">
          <div class="hx-scene__head">
            <p class="hx-scene__step">
              <span class="hx-scene__num">07</span>Transitions
            </p>
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
        </div>
      </ScrollStage>
    </section>
  );
}
