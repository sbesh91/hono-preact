import type { FunctionComponent } from 'preact';
import { useMeta, useTitle } from 'hoofd/preact';
import { HeroShader } from '../components/HeroShader.js';
import { ChapterEdge } from '../components/home/chapters/ChapterEdge.js';
import { ChapterRouting } from '../components/home/chapters/ChapterRouting.js';
import { ChapterSSR } from '../components/home/chapters/ChapterSSR.js';
import { ChapterStreaming } from '../components/home/chapters/ChapterStreaming.js';
import { ChapterMutations } from '../components/home/chapters/ChapterMutations.js';
import { ChapterResilience } from '../components/home/chapters/ChapterResilience.js';
import { ChapterPrefetch } from '../components/home/chapters/ChapterPrefetch.js';
import { ChapterTransitions } from '../components/home/chapters/ChapterTransitions.js';
import { ChapterRealtime } from '../components/home/chapters/ChapterRealtime.js';
import { ChapterOnePackage } from '../components/home/chapters/ChapterOnePackage.js';
import { ChapterCTA } from '../components/home/chapters/ChapterCTA.js';

const Home: FunctionComponent = () => {
  useTitle('hono-preact');
  useMeta({
    name: 'description',
    content:
      'Watch the connection come alive: hono-preact fetches, streams, mutates, transitions, and goes live, edge to browser.',
  });
  return (
    <div class="hx-home">
      <main class="relative">
        {/* Hero (the shader is confined to the hero, not the whole page) */}
        <header class="hx-hero">
          <HeroShader />
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
          <p class="hx-hero__scroll" aria-hidden="true">
            Scroll to assemble
            <span class="hx-hero__scroll-arrow" />
          </p>
        </header>

        {/* Chapters, in order */}
        <ChapterEdge />
        <ChapterRouting />
        <ChapterSSR />
        <ChapterStreaming />
        <ChapterMutations />
        <ChapterResilience />
        <ChapterPrefetch />
        <ChapterTransitions />
        <ChapterRealtime />
        <ChapterOnePackage />
        <ChapterCTA />
      </main>
    </div>
  );
};
Home.displayName = 'Home';

export default Home;
