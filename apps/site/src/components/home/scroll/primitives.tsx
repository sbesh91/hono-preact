import type { ComponentChildren, VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useStage, useStageValue } from './stage.js';
import { barStatus, laneCap } from './progress.js';
import { useInView, usePrefersReducedMotion } from './motion.js';

/**
 * The scrub head that rides along a wire. The bar itself stays put at the track's
 * left edge; the track is a full-width box that CSS slides by `--hx-p * 100%` of
 * its own width, which is what lets a 2px element travel the wire on the
 * compositor. (A percentage translate resolves against the element's own box, so
 * moving the 2px bar directly could never express "fraction of the wire".)
 */
export function Playhead(): VNode {
  return (
    <span class="hx-playhead-track" aria-hidden="true">
      <span class="hx-playhead" />
    </span>
  );
}

export function Wire({
  caption,
  children,
}: {
  caption: string;
  children: ComponentChildren;
}): VNode {
  return (
    <div class="hx-wire">
      <div class="hx-wire__cap">{caption}</div>
      {children}
      <Playhead />
    </div>
  );
}

export function Lane({
  label,
  start,
  size,
  tone = 'accent',
  cancelAt,
}: {
  label: string;
  start: number;
  size: number;
  tone?: 'accent' | 'grad';
  cancelAt?: number;
}): VNode {
  // The fill's width is CSS's job (scaleX off --hx-p, clamped to --lane-cap).
  // Only the status is read in JS, and it takes four values across a whole
  // scrub, so this component renders a handful of times rather than every frame.
  const state = useStageValue((progress) =>
    barStatus(progress, start, size, cancelAt)
  );
  return (
    <div class="hx-lane">
      <span class="hx-lane__label">{label}</span>
      <span class="hx-lane__track">
        <span
          class={`hx-lane__fill hx-lane__fill--${tone}`}
          data-state={state}
          style={{
            '--lane-start': start,
            '--lane-size': size,
            '--lane-cap': laneCap(start, size, cancelAt),
          }}
        />
      </span>
    </div>
  );
}

export function BrowserFrame({
  url,
  live,
  children,
}: {
  url: string;
  live?: boolean;
  children: ComponentChildren;
}): VNode {
  return (
    <div class="hx-browser">
      <div class="hx-browser__bar">
        <i />
        <i />
        <i />
        <span class="hx-browser__url">{url}</span>
        {live ? (
          <span class="hx-live-tag">
            <b />
            live
          </span>
        ) : null}
      </div>
      <div class="hx-browser__body">{children}</div>
    </div>
  );
}

export function Region({
  showAt,
  skeleton,
  children,
}: {
  showAt: number;
  skeleton: ComponentChildren;
  children: ComponentChildren;
}): VNode {
  const { live } = useStage();
  // The skeleton/content crossfade is continuous now: CSS fades one into the
  // other across a short window that *lands on* `showAt` (--region-at), so it
  // tracks the reader's scroll instead of firing a fixed 300ms transition that
  // lags behind a fast scrub.
  //
  // Landing on showAt rather than starting there is what keeps the two halves of
  // this component on one clock. `shown` is a step at showAt, and it drives both
  // the assistive-tech labelling below and (via [data-shown]) the mutations
  // chapter's save-flash. Had the fade *started* at showAt, the row would be at
  // opacity 0 exactly when it was announced as shown and exactly when its flash
  // played -- 0.05 of scrub in which the screen reader and the eye disagree.
  const passed = useStageValue((progress) => progress >= showAt);
  // Until client JS is actually driving the playhead (SSR, a failed bundle,
  // no-JS), show the content: a skeleton must never be the terminal state.
  const shown = !live || passed;
  return (
    <div
      class="hx-region"
      data-live={String(live)}
      data-shown={String(shown)}
      style={{ '--region-at': showAt }}
    >
      <div class="hx-region__skeleton" aria-hidden={shown ? 'true' : undefined}>
        {skeleton}
      </div>
      <div class="hx-region__content">{children}</div>
    </div>
  );
}

export function Reveal({
  children,
  delayMs = 0,
}: {
  children: ComponentChildren;
  delayMs?: number;
}): VNode {
  const reduced = usePrefersReducedMotion();
  // useInView owns the IntersectionObserver wiring (same threshold/margin and
  // disconnect-once semantics this component used to duplicate inline).
  const [ref, inView] = useInView<HTMLDivElement>({ disabled: reduced });
  // 'static' is the SSR/no-JS/reduced state and renders fully visible; the
  // mount effect arms the scroll-in animation only once client JS is running
  // with IntersectionObserver available, so a failed bundle or a JS-less
  // browser never strands the content invisible.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    setArmed(!reduced && typeof IntersectionObserver !== 'undefined');
  }, [reduced]);
  const state = !armed ? 'static' : inView ? 'shown' : 'hidden';
  return (
    <div
      class="hx-reveal"
      ref={ref}
      data-reveal-state={state}
      style={{ transitionDelay: `${delayMs}ms` }}
    >
      {children}
    </div>
  );
}
