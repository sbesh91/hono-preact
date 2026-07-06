import type { ComponentChildren, VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useStageProgress } from './stage.js';
import { barState } from './progress.js';
import { usePrefersReducedMotion } from './motion.js';

export function Playhead(): VNode {
  const { progress } = useStageProgress();
  return (
    <div
      class="hx-playhead"
      aria-hidden="true"
      style={{ left: `${progress * 100}%` }}
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
  const { progress } = useStageProgress();
  const { width, state } = barState(progress, start, size, cancelAt);
  return (
    <div class="hx-lane">
      <span class="hx-lane__label">{label}</span>
      <span class="hx-lane__track">
        <span
          class={`hx-lane__fill hx-lane__fill--${tone}`}
          data-state={state}
          style={{ width: `${width * 100}%` }}
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
  const { progress } = useStageProgress();
  const shown = progress >= showAt;
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
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (reduced || typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.18, rootMargin: '0px 0px -8% 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);
  return (
    <div
      class="hx-reveal"
      ref={ref}
      data-shown={String(shown)}
      style={{ transitionDelay: `${delayMs}ms` }}
    >
      {children}
    </div>
  );
}
