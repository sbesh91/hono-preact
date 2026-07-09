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
      'One framework from the edge to the browser: Hono on the server, Preact on the client, and a single typed connection for routing, data, mutations, and realtime.',
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
            {/* The wordmark is the wire: "edge to browser" fills with the
                orangenta gradient as a packet travels a wire beneath it. Pure
                CSS load animation; the finished wordmark is the default state,
                so no-JS and reduced-motion render it complete. */}
            <h1 class="hx-hero__title">
              One framework,
              <br />
              <span class="hx-hero__wire">
                <span class="hx-hero__wm-base" aria-hidden="true">
                  edge to browser
                </span>
                <span class="hx-hero__wm-fill">edge to browser</span>
                <span class="hx-hero__wire-line" aria-hidden="true" />
                <span class="hx-hero__edge" aria-hidden="true" />
                <span class="hx-hero__packet" aria-hidden="true" />
                <span class="hx-hero__browser" aria-hidden="true" />
              </span>
            </h1>
            <p class="hx-hero__lede">
              Hono at the edge, Preact in the browser, and one typed connection
              between them.
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

        <footer class="hx-footer">
          <div class="hx-wrap hx-footer__row">
            <span>
              <a href="https://github.com/sbesh91/hono-preact">GitHub</a>
              {' · '}
              <a href="https://www.npmjs.com/package/hono-preact">npm</a>
            </span>
            <span>MIT</span>
          </div>
        </footer>
      </main>
    </div>
  );
};
Home.displayName = 'Home';

export default Home;
