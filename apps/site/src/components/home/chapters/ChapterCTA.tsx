import type { VNode } from 'preact';
import { Reveal } from '../scroll/primitives.js';

export function ChapterCTA(): VNode {
  return (
    <section class="hx-chapter">
      <div class="hx-scene hx-cta">
        <Reveal>
          <div class="hx-scene__head">
            <p class="hx-scene__step hx-scene__step--muted">Ready?</p>
            <h2 class="hx-scene__title">Build something that feels alive.</h2>
            <p class="hx-scene__desc">
              You have seen the whole connection: fetch, stream, mutate,
              transition, and go live, all typed. Start with the quick start, or
              poke at the live demo.
            </p>
          </div>
          <div class="hx-cta__actions">
            <a
              class="hx-cta__btn hx-cta__btn--primary"
              href="/docs/quick-start"
            >
              Get started
            </a>
            <a class="hx-cta__btn hx-cta__btn--secondary" href="/demo">
              See the demo
            </a>
          </div>
          <p class="hx-cta__note">
            These buttons are already prefetched, hover them and the docs are
            warming via the site's own Speculation Rules.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
