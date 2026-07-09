import { defineApp } from 'hono-preact';
import light from '@/styles/fonts/selawik-light.woff2?url';
import semibold from '@/styles/fonts/selawik-semibold.woff2?url';
import bold from '@/styles/fonts/selawik-bold.woff2?url';

// Dogfood the framework's Speculation Rules emitter: the docs site is navigation-
// heavy with same-origin, idempotent GET routes, so prefetch-on-moderate-eagerness
// is a real win (and the docs tell users to enable exactly this). The generated
// server entry picks up this default export automatically. Per-link opt-out is
// `data-no-prefetch`; cross-origin links (npm, GitHub) are never prefetched.
//
// Preload exactly the three weights the hero renders above the fold: the light
// (300) lede, the semibold (600) eyebrow + CTAs, and the bold (700) wordmark.
// Regular (400) is body copy further down the page, so it loads on demand via
// its @font-face rather than being preloaded (preloading it just races an unused
// file against these three). font-display stays `optional` in root.css: the
// preload gives the brand font a real chance to win the optional window without
// risking layout shift.
export default defineApp({
  speculation: true,
  fonts: [light, semibold, bold],
});
