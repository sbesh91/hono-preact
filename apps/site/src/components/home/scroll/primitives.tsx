import type { ComponentChildren, RefObject, VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useStageProgress } from './stage.js';
import { barState } from './progress.js';
import { useInView, usePrefersReducedMotion } from './motion.js';

// Tracks an element's content width in px so scroll-driven children can
// position themselves with `transform` instead of a percentage `left`/`width`
// (which is a layout property recomputed on every progress tick).
function useElementWidth<T extends Element>(): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export function Playhead({ trackWidth }: { trackWidth: number }): VNode {
  const { progress } = useStageProgress();
  return (
    <div
      class="hx-playhead"
      aria-hidden="true"
      style={{ transform: `translateX(${progress * trackWidth}px)` }}
    />
  );
}

export function Wire({
  caption,
  children,
}: {
  caption: string;
  children: ComponentChildren;
}): VNode {
  const [ref, trackWidth] = useElementWidth<HTMLDivElement>();
  return (
    <div class="hx-wire" ref={ref}>
      <div class="hx-wire__cap">{caption}</div>
      {children}
      <Playhead trackWidth={trackWidth} />
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
  const { progress } = useStageProgress();
  const { width, state } = barState(progress, start, size, cancelAt);
  return (
    <div class="hx-lane">
      <span class="hx-lane__label">{label}</span>
      <span class="hx-lane__track">
        <span
          class={`hx-lane__fill hx-lane__fill--${tone}`}
          data-state={state}
          style={{ transform: `scaleX(${width})` }}
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
  const { progress, live } = useStageProgress();
  // Until client JS is actually driving the playhead (SSR, a failed bundle,
  // no-JS), show the content: a skeleton must never be the terminal state.
  const shown = !live || progress >= showAt;
  return (
    <div class="hx-region" data-shown={String(shown)}>
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
