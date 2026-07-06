import type { FunctionComponent } from 'preact';
import { useMeta, useTitle } from 'hoofd/preact';
import { HeroShader } from '../components/HeroShader.js';

const Home: FunctionComponent = () => {
  useTitle('hono-preact');
  useMeta({
    name: 'description',
    content:
      'Watch the connection come alive: hono-preact fetches, streams, mutates, transitions, and goes live, edge to browser.',
  });
  return (
    <div class="hx-home relative isolate overflow-hidden">
      <HeroShader />
      <main class="relative">
        {/* Hero */}
        <header class="hx-hero">
          <div class="hx-wrap">
            <span class="energy-bar w-16" aria-hidden="true" />
            <p class="hx-eyebrow">hono-preact v{__HONO_PREACT_VERSION__}</p>
            <h1 class="hx-hero__title">
              One framework, <span class="text-orangenta">edge to browser</span>
              .
            </h1>
            <p class="hx-hero__lede">
              Scroll down and watch a request assemble itself into a live page:
              routing, streaming, mutations, transitions, and realtime, all
              typed.
            </p>
            <div class="hx-hero__cta">
              <a class="hx-btn hx-btn--primary" href="/docs/quick-start">
                Get started
              </a>
              <a class="hx-btn hx-btn--ghost" href="/demo">
                See the demo
              </a>
            </div>
          </div>
        </header>

        {/* Chapters are added by later tasks, in order:
            <ChapterEdge /> <ChapterRouting /> <ChapterSSR /> <ChapterStreaming />
            <ChapterMutations /> <ChapterResilience /> <ChapterPrefetch />
            <ChapterTransitions /> <ChapterRealtime /> <ChapterOnePackage /> <ChapterCTA /> */}
      </main>
    </div>
  );
};
Home.displayName = 'Home';

export default Home;
